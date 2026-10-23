import { Router } from "express";
import { z } from "zod";
import { generateApiKey, hashApiKey } from "../auth/apiKey";
import { DEFAULT_ACCOUNT_PLAN_ID } from "../config/constants";
import { pool } from "../database/pool";
import { asyncHandler } from "../http/errors";
import { parseWith, uuidSchema } from "../http/validate";
import { authenticate } from "../middleware/authenticate";
import { assertPlanAssignable } from "../services/planAccess";

export const accountsRouter = Router();

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const changeAccountPlanSchema = z.object({ planId: uuidSchema });

// The account with its current plan, in the shape we return to callers.
async function loadAccount(accountId: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.created_at,
            p.id AS plan_id, p.name AS plan_name,
            p.monthly_limit, p.max_units_per_request, p.is_predefined
       FROM accounts a
       JOIN plans p ON p.id = a.plan_id
      WHERE a.id = $1`,
    [accountId]
  );
  const row = rows[0];

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      monthlyLimit: row.monthly_limit,
      maxUnitsPerRequest: row.max_units_per_request,
      isPredefined: row.is_predefined,
    },
  };
}

// Public: create an account and issue its API key (shown only once).
accountsRouter.post(
  "/accounts",
  asyncHandler(async (req, res) => {
    const { name } = parseWith(createAccountSchema, req.body);

    const apiKey = generateApiKey();

    const { rows } = await pool.query(
      `INSERT INTO accounts (name, api_key_hash, plan_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, plan_id, created_at`,
      [name, hashApiKey(apiKey), DEFAULT_ACCOUNT_PLAN_ID]
    );
    const account = rows[0];

    res.status(201).json({
      account: {
        id: account.id,
        name: account.name,
        planId: account.plan_id,
        createdAt: account.created_at,
      },
      apiKey,
      message: "Store this API key now. It cannot be shown again.",
    });
  })
);

// Protected: the account that owns the API key, with its plan.
accountsRouter.get(
  "/account",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ account: await loadAccount(req.account!.id) });
  })
);

// Protected: assign a plan to the calling account (sets the shared pool).
accountsRouter.put(
  "/account/plan",
  authenticate,
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const { planId } = parseWith(changeAccountPlanSchema, req.body);

    await assertPlanAssignable(accountId, planId);

    // Only the plan changes. account_usage is untouched, so used units are kept.
    await pool.query("UPDATE accounts SET plan_id = $1 WHERE id = $2", [planId, accountId]);

    res.json({ account: await loadAccount(accountId) });
  })
);