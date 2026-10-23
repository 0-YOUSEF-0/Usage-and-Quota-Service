import { Router } from "express";
import { z } from "zod";
import { DEFAULT_USER_PLAN_ID } from "../config/constants";
import { isUniqueViolation } from "../database/errors";
import { pool } from "../database/pool";
import { currentUsageMonth } from "../domain/month";
import { HttpError, asyncHandler } from "../http/errors";
import { parseWith, uuidSchema } from "../http/validate";
import { authenticate } from "../middleware/authenticate";
import { assertPlanAssignable } from "../services/planAccess";

export const usersRouter = Router();

// Every route in this file requires a valid API key.
usersRouter.use(authenticate);

const externalIdSchema = z.string().trim().min(1).max(200);

const createUserSchema = z.object({
  externalId: externalIdSchema,
  name: z.string().trim().min(1).max(200).optional(),
  planId: uuidSchema.optional(),
});

const changePlanSchema = z.object({ planId: uuidSchema });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------- shared query and formatting ----------

interface UserRow {
  id: string;
  external_id: string;
  name: string | null;
  created_at: Date;
  plan_id: string;
  plan_name: string;
  monthly_limit: number;
  max_units_per_request: number;
  is_predefined: boolean;
  units_used: number;
}

// $1 = account id, $2 = usage month. Callers append WHERE / ORDER BY.
const USER_SELECT = `
  SELECT u.id, u.external_id, u.name, u.created_at,
         p.id AS plan_id, p.name AS plan_name,
         p.monthly_limit, p.max_units_per_request, p.is_predefined,
         COALESCE(uu.units_used, 0) AS units_used
    FROM users u
    JOIN plans p ON p.id = u.plan_id
    LEFT JOIN user_usage uu
           ON uu.user_id = u.id AND uu.usage_month = $2::date
`;

function toUserJson(row: UserRow, month: string) {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    createdAt: row.created_at,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      monthlyLimit: row.monthly_limit,
      maxUnitsPerRequest: row.max_units_per_request,
      isPredefined: row.is_predefined,
    },
    usage: {
      month,
      unitsUsed: row.units_used,
      // Never negative, even if the limit was lowered below current usage.
      remaining: Math.max(0, row.monthly_limit - row.units_used),
    },
  };
}

// Looks a user up INSIDE the calling account only.
async function findUser(accountId: string, externalId: string) {
  const month = currentUsageMonth();
  const { rows } = await pool.query<UserRow>(
    `${USER_SELECT} WHERE u.account_id = $1 AND u.external_id = $3`,
    [accountId, month, externalId]
  );

  if (rows.length === 0) {
    throw new HttpError(404, "user_not_found", "User not found.");
  }
  return toUserJson(rows[0], month);
}

// ---------- routes ----------

// Create a user
usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const body = parseWith(createUserSchema, req.body);
    const planId = body.planId ?? DEFAULT_USER_PLAN_ID;

    await assertPlanAssignable(accountId, planId);

    try {
      await pool.query(
        `INSERT INTO users (account_id, external_id, name, plan_id)
         VALUES ($1, $2, $3, $4)`,
        [accountId, body.externalId, body.name ?? null, planId]
      );
    } catch (err) {
      if (isUniqueViolation(err, "users_account_external_uniq")) {
        throw new HttpError(
          409,
          "user_already_exists",
          `A user with externalId "${body.externalId}" already exists in this account.`
        );
      }
      throw err;
    }

    res.status(201).json({ user: await findUser(accountId, body.externalId) });
  })
);

// List this account's users
usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const { page, pageSize } = parseWith(listQuerySchema, req.query);
    const month = currentUsageMonth();

    const totalResult = await pool.query<{ count: number }>(
      "SELECT count(*) FROM users WHERE account_id = $1",
      [accountId]
    );

    const { rows } = await pool.query<UserRow>(
      `${USER_SELECT}
        WHERE u.account_id = $1
        ORDER BY u.created_at, u.id
        LIMIT $3 OFFSET $4`,
      [accountId, month, pageSize, (page - 1) * pageSize]
    );

    res.json({
      users: rows.map((row) => toUserJson(row, month)),
      page,
      pageSize,
      total: totalResult.rows[0].count,
    });
  })
);

// View one user
usersRouter.get(
  "/:externalId",
  asyncHandler(async (req, res) => {
    const externalId = parseWith(externalIdSchema, req.params.externalId);
    res.json({ user: await findUser(req.account!.id, externalId) });
  })
);

// Change a user's plan
usersRouter.put(
  "/:externalId/plan",
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const externalId = parseWith(externalIdSchema, req.params.externalId);
    const { planId } = parseWith(changePlanSchema, req.body);

    await assertPlanAssignable(accountId, planId);

    // Only the plan changes. user_usage is not touched, so used units are kept.
    const result = await pool.query(
      `UPDATE users SET plan_id = $1
        WHERE account_id = $2 AND external_id = $3`,
      [planId, accountId, externalId]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, "user_not_found", "User not found.");
    }

    res.json({ user: await findUser(accountId, externalId) });
  })
);