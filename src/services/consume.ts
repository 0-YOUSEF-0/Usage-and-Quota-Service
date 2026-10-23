import type { PoolClient } from "pg";
import { isUniqueViolation } from "../database/errors";
import { pool } from "../database/pool";
import { withClient, withTransaction } from "../database/transaction";
import { currentUsageMonth } from "../domain/month";
import {
  describeRejection,
  evaluate,
  remainingOf,
  type LevelState,
  type Rejection,
} from "../domain/rules";
import { HttpError } from "../http/errors";

export interface ConsumeInput {
  accountId: string;
  externalId: string;
  units: number;
  requestId: string;
}

interface LevelView {
  planId: string;
  planName: string;
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  unitsUsed: number;
  remaining: number;
}

export interface Decision {
  requestId: string;
  accepted: boolean;
  units: number;
  month: string;
  rejection: (Rejection & { message: string }) | null;
  user: LevelView & { externalId: string };
  account: LevelView;
  replayed: boolean;
}

interface HistoryRow {
  user_id: string;
  units: number;
  accepted: boolean;
  rejected_level: "account" | "user" | null;
  rejected_rule: "max_units_per_request" | "monthly_allowance" | null;
  usage_month: string;
  details: { message: string | null; user: LevelView; account: LevelView };
}

interface PlanRow {
  account_plan_id: string;
  account_plan_name: string;
  account_monthly_limit: number;
  account_max_per_request: number;
  user_plan_id: string;
  user_plan_name: string;
  user_monthly_limit: number;
  user_max_per_request: number;
}

function toView(state: LevelState): LevelView {
  return { ...state, remaining: remainingOf(state) };
}

async function findHistory(
  client: PoolClient,
  accountId: string,
  requestId: string
) {
  const { rows } = await client.query<HistoryRow>(
    `SELECT user_id, units, accepted, rejected_level, rejected_rule, usage_month, details
       FROM request_history
      WHERE account_id = $1 AND request_id = $2`,
    [accountId, requestId]
  );

  return rows[0];
}

// A repeated request ID returns the ORIGINAL answer and counts nothing.
// The same ID with different details is a client mistake (409).
function replayDecision(
  row: HistoryRow,
  input: ConsumeInput,
  userId: string
): Decision {
  if (row.user_id !== userId || row.units !== input.units) {
    throw new HttpError(
      409,
      "request_id_conflict",
      `Request ID "${input.requestId}" was already used with different details.`
    );
  }

  return {
    requestId: input.requestId,
    accepted: row.accepted,
    units: row.units,
    month: row.usage_month,
    rejection: row.accepted
      ? null
      : {
          level: row.rejected_level!,
          rule: row.rejected_rule!,
          message: row.details.message ?? "",
        },
    user: { externalId: input.externalId, ...row.details.user },
    account: row.details.account,
    replayed: true,
  };
}

async function decide(
  client: PoolClient,
  input: ConsumeInput,
  userId: string,
  month: string
): Promise<Decision> {
  // 1. Lock the account's usage row, creating it if this is the first use this month.
  //    All consumes for one account wait here, one at a time.
  const accountUsage = await client.query<{ units_used: number }>(
    `INSERT INTO account_usage (account_id, usage_month) VALUES ($1, $2)
     ON CONFLICT (account_id, usage_month)
     DO UPDATE SET updated_at = account_usage.updated_at
     RETURNING units_used`,
    [input.accountId, month]
  );

  // 2. Retry check. Safe now, because requests of this account take turns.
  const existing = await findHistory(client, input.accountId, input.requestId);

  if (existing) {
    return replayDecision(existing, input, userId);
  }

  // 3. Lock the user's usage row, creating it if this is the first use this month.
  //    Account first, then user: all consumes follow the same lock order.
  const userUsage = await client.query<{ units_used: number }>(
    `INSERT INTO user_usage (user_id, usage_month) VALUES ($1, $2)
     ON CONFLICT (user_id, usage_month)
     DO UPDATE SET updated_at = user_usage.updated_at
     RETURNING units_used`,
    [userId, month]
  );

  // 4. Read the plans that apply right now.
  const planResult = await client.query<PlanRow>(
    `SELECT ap.id AS account_plan_id, ap.name AS account_plan_name,
            ap.monthly_limit AS account_monthly_limit,
            ap.max_units_per_request AS account_max_per_request,
            up.id AS user_plan_id, up.name AS user_plan_name,
            up.monthly_limit AS user_monthly_limit,
            up.max_units_per_request AS user_max_per_request
       FROM accounts a
       JOIN plans ap ON ap.id = a.plan_id
       JOIN users u  ON u.id = $2 AND u.account_id = a.id
       JOIN plans up ON up.id = u.plan_id
      WHERE a.id = $1`,
    [input.accountId, userId]
  );

  const p = planResult.rows[0];

  const accountState: LevelState = {
    planId: p.account_plan_id,
    planName: p.account_plan_name,
    monthlyLimit: p.account_monthly_limit,
    maxUnitsPerRequest: p.account_max_per_request,
    unitsUsed: accountUsage.rows[0].units_used,
  };

  const userState: LevelState = {
    planId: p.user_plan_id,
    planName: p.user_plan_name,
    monthlyLimit: p.user_monthly_limit,
    maxUnitsPerRequest: p.user_max_per_request,
    unitsUsed: userUsage.rows[0].units_used,
  };

  // 5. Decide.
  const rejection = evaluate(input.units, userState, accountState);

  const message = rejection
    ? describeRejection(rejection, input.units, userState, accountState)
    : null;

  // 6. Count the usage ONLY if accepted (both counters, same transaction).
  if (!rejection) {
    await client.query(
      `UPDATE account_usage SET units_used = units_used + $3, updated_at = now()
        WHERE account_id = $1 AND usage_month = $2`,
      [input.accountId, month, input.units]
    );

    await client.query(
      `UPDATE user_usage SET units_used = units_used + $3, updated_at = now()
        WHERE user_id = $1 AND usage_month = $2`,
      [userId, month, input.units]
    );

    accountState.unitsUsed += input.units;
    userState.unitsUsed += input.units;
  }

  // 7. Record the decision, with a snapshot of the limits that applied.
  const details = {
    message,
    user: toView(userState),
    account: toView(accountState),
  };

  await client.query(
    `INSERT INTO request_history
       (account_id, user_id, request_id, units, accepted,
        rejected_level, rejected_rule, usage_month, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      input.accountId,
      userId,
      input.requestId,
      input.units,
      rejection === null,
      rejection?.level ?? null,
      rejection?.rule ?? null,
      month,
      JSON.stringify(details),
    ]
  );

  return {
    requestId: input.requestId,
    accepted: rejection === null,
    units: input.units,
    month,
    rejection: rejection ? { ...rejection, message: message! } : null,
    user: { externalId: input.externalId, ...details.user },
    account: details.account,
    replayed: false,
  };
}

// `now` can be passed in tests to pretend it is another month.
export async function consume(
  input: ConsumeInput,
  now: Date = new Date()
): Promise<Decision> {
  // The user must belong to the calling account (otherwise 404).
  const userResult = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE account_id = $1 AND external_id = $2",
    [input.accountId, input.externalId]
  );

  if (userResult.rows.length === 0) {
    throw new HttpError(404, "user_not_found", "User not found.");
  }

  const userId = userResult.rows[0].id;
  const month = currentUsageMonth(now);

  try {
    return await withTransaction((client) =>
      decide(client, input, userId, month)
    );
  } catch (err) {
    // Safety net: if two identical requests ever raced past the check,
    // the database's unique key stops the second one. Answer with the first result.
    if (isUniqueViolation(err, "request_history_account_request_uniq")) {
      const existing = await withClient((client) =>
        findHistory(client, input.accountId, input.requestId)
      );

      if (existing) {
        return replayDecision(existing, input, userId);
      }
    }

    throw err;
  }
}

