import { Router } from "express";
import { z } from "zod";
import { isUniqueViolation } from "../database/errors";
import { pool } from "../database/pool";
import { HttpError, asyncHandler } from "../http/errors";
import { parseWith, uuidSchema } from "../http/validate";
import { authenticate } from "../middleware/authenticate";

export const plansRouter = Router();

// Every route in this file requires a valid API key.
plansRouter.use(authenticate);

// ---------- validation ----------

const MAX_LIMIT = 1_000_000_000_000;
const limitSchema = z.number().int().min(1).max(MAX_LIMIT);
const nameSchema = z.string().trim().min(1).max(100);
const descriptionSchema = z.string().trim().max(500);

const createPlanSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  monthlyLimit: limitSchema,
  maxUnitsPerRequest: limitSchema,
});

const updatePlanSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    monthlyLimit: limitSchema.optional(),
    maxUnitsPerRequest: limitSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

// ---------- helpers ----------

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  monthly_limit: number;
  max_units_per_request: number;
  is_predefined: boolean;
  created_at: Date;
  updated_at: Date;
}

const PLAN_COLUMNS = `id, name, description, monthly_limit,
                      max_units_per_request, is_predefined, created_at, updated_at`;

function toPlanJson(row: PlanRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    monthlyLimit: row.monthly_limit,
    maxUnitsPerRequest: row.max_units_per_request,
    isPredefined: row.is_predefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A plan is visible if it is predefined or owned by the calling account.
async function findVisiblePlan(accountId: string, planId: string): Promise<PlanRow> {
  const { rows } = await pool.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM plans
      WHERE id = $1 AND (account_id IS NULL OR account_id = $2)`,
    [planId, accountId]
  );

  if (rows.length === 0) {
    throw new HttpError(404, "plan_not_found", "Plan not found.");
  }
  return rows[0];
}

// Custom plans may not reuse a predefined plan's name.
async function assertNameNotPredefined(name: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT 1 FROM plans WHERE account_id IS NULL AND lower(name) = lower($1)",
    [name]
  );
  if (rows.length > 0) {
    throw new HttpError(
      409,
      "plan_name_taken",
      `"${name}" is the name of a predefined plan. Choose a different name.`
    );
  }
}

function planNameTaken(name: string): HttpError {
  return new HttpError(
    409,
    "plan_name_taken",
    `You already have a plan named "${name}".`
  );
}

// ---------- routes ----------

// List predefined plans and this account's custom plans
plansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans
        WHERE account_id IS NULL OR account_id = $1
        ORDER BY is_predefined DESC, lower(name)`,
      [req.account!.id]
    );
    res.json({ plans: rows.map(toPlanJson) });
  })
);

// View one plan
plansRouter.get(
  "/:planId",
  asyncHandler(async (req, res) => {
    const planId = parseWith(uuidSchema, String(req.params.planId));
    const plan = await findVisiblePlan(req.account!.id, planId);
    res.json({ plan: toPlanJson(plan) });
  })
);

// Create a custom plan
plansRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const body = parseWith(createPlanSchema, req.body);

    await assertNameNotPredefined(body.name);

    try {
      const { rows } = await pool.query<PlanRow>(
        `INSERT INTO plans
           (account_id, name, description, monthly_limit, max_units_per_request, is_predefined)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING ${PLAN_COLUMNS}`,
        [
          accountId,
          body.name,
          body.description ?? null,
          body.monthlyLimit,
          body.maxUnitsPerRequest,
        ]
      );
      res.status(201).json({ plan: toPlanJson(rows[0]) });
    } catch (err) {
      if (isUniqueViolation(err, "plans_custom_name_uniq")) throw planNameTaken(body.name);
      throw err;
    }
  })
);

// Edit one of your own custom plans
plansRouter.patch(
  "/:planId",
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const planId = parseWith(uuidSchema, String(req.params.planId));
    const changes = parseWith(updatePlanSchema, req.body);

    const plan = await findVisiblePlan(accountId, planId);

    if (plan.is_predefined) {
      throw new HttpError(
        403,
        "plan_read_only",
        "Predefined plans cannot be modified. Create a custom plan instead."
      );
    }

    if (changes.name !== undefined) await assertNameNotPredefined(changes.name);

    try {
      const { rows } = await pool.query<PlanRow>(
        `UPDATE plans
            SET name                  = COALESCE($3, name),
                description           = COALESCE($4, description),
                monthly_limit         = COALESCE($5, monthly_limit),
                max_units_per_request = COALESCE($6, max_units_per_request),
                updated_at            = now()
          WHERE id = $1 AND account_id = $2
          RETURNING ${PLAN_COLUMNS}`,
        [
          planId,
          accountId,
          changes.name ?? null,
          changes.description ?? null,
          changes.monthlyLimit ?? null,
          changes.maxUnitsPerRequest ?? null,
        ]
      );
      res.json({ plan: toPlanJson(rows[0]) });
    } catch (err) {
      if (isUniqueViolation(err, "plans_custom_name_uniq")) {
        throw planNameTaken(changes.name ?? plan.name);
      }
      throw err;
    }
  })
);