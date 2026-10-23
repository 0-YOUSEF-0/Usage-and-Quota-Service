import { Router } from "express";
import { z } from "zod";
import { generateApiKey, hashApiKey } from "../auth/apiKey";
import { DEFAULT_ACCOUNT_PLAN_ID } from "../config/constants";
import { pool } from "../database/pool";
import { asyncHandler } from "../http/errors";
import { parseWith } from "../http/validate";
import { authenticate } from "../middleware/authenticate";

export const accountsRouter = Router();

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

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
    // The id comes from the authenticated key, never from the request.
    const accountId = req.account!.id;

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

    res.json({
      account: {
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
      },
    });
  })
);