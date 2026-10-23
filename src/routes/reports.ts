import { Router } from "express";
import { z } from "zod";
import { pool } from "../database/pool";
import { currentUsageMonth } from "../domain/month";
import { asyncHandler } from "../http/errors";
import { parseWith } from "../http/validate";
import { authenticate } from "../middleware/authenticate";

export const reportsRouter = Router();

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM");

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const usageQuerySchema = z.object({ month: monthSchema.optional(), ...paging });

const historyQuerySchema = z.object({
  ...paging,
  month: monthSchema.optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  accepted: z.enum(["true", "false"]).optional(),
});

const remainingOf = (limit: number, used: number) => Math.max(0, limit - used);

// Usage for one UTC month: the account and each of its users.
// Limits shown are the plans CURRENTLY applied, even for past months.
reportsRouter.get(
  "/usage",
  authenticate,
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const q = parseWith(usageQuerySchema, req.query);
    const month = q.month ? `${q.month}-01` : currentUsageMonth();

    const accountRow = (
      await pool.query(
        `SELECT p.id AS plan_id, p.name AS plan_name, p.monthly_limit,
                p.max_units_per_request, COALESCE(au.units_used, 0) AS units_used
           FROM accounts a
           JOIN plans p ON p.id = a.plan_id
           LEFT JOIN account_usage au
                  ON au.account_id = a.id AND au.usage_month = $2::date
          WHERE a.id = $1`,
        [accountId, month]
      )
    ).rows[0];

    const totals = (
      await pool.query(
        `SELECT (SELECT count(*) FROM users WHERE account_id = $1) AS total_users,
                (SELECT COALESCE(SUM(uu.units_used), 0)::bigint
                   FROM user_usage uu JOIN users u ON u.id = uu.user_id
                  WHERE u.account_id = $1 AND uu.usage_month = $2::date) AS users_units`,
        [accountId, month]
      )
    ).rows[0];

    const users = await pool.query(
      `SELECT u.external_id, p.id AS plan_id, p.name AS plan_name,
              p.monthly_limit, p.max_units_per_request,
              COALESCE(uu.units_used, 0) AS units_used
         FROM users u
         JOIN plans p ON p.id = u.plan_id
         LEFT JOIN user_usage uu
                ON uu.user_id = u.id AND uu.usage_month = $2::date
        WHERE u.account_id = $1
        ORDER BY u.created_at, u.id
        LIMIT $3 OFFSET $4`,
      [accountId, month, q.pageSize, (q.page - 1) * q.pageSize]
    );

    res.json({
      month,
      account: {
        plan: {
          id: accountRow.plan_id,
          name: accountRow.plan_name,
          monthlyLimit: accountRow.monthly_limit,
          maxUnitsPerRequest: accountRow.max_units_per_request,
        },
        unitsUsed: accountRow.units_used,
        remaining: remainingOf(accountRow.monthly_limit, accountRow.units_used),
      },
      // Should always equal account.unitsUsed (the account total is the sum of its users).
      usersUnitsTotal: totals.users_units,
      users: users.rows.map((row) => ({
        externalId: row.external_id,
        plan: {
          id: row.plan_id,
          name: row.plan_name,
          monthlyLimit: row.monthly_limit,
          maxUnitsPerRequest: row.max_units_per_request,
        },
        unitsUsed: row.units_used,
        remaining: remainingOf(row.monthly_limit, row.units_used),
      })),
      page: q.page,
      pageSize: q.pageSize,
      totalUsers: totals.total_users,
    });
  })
);

// Request history, newest first, with simple page/pageSize pagination.
reportsRouter.get(
  "/history",
  authenticate,
  asyncHandler(async (req, res) => {
    const accountId = req.account!.id;
    const q = parseWith(historyQuerySchema, req.query);

    const filters = [
      accountId,
      q.externalId ?? null,
      q.accepted === undefined ? null : q.accepted === "true",
      q.month ? `${q.month}-01` : null,
    ];

    const where = `
      h.account_id = $1
      AND ($2::text IS NULL OR u.external_id = $2::text)
      AND ($3::boolean IS NULL OR h.accepted = $3::boolean)
      AND ($4::date IS NULL OR h.usage_month = $4::date)`;

    const total = (
      await pool.query(
        `SELECT count(*) FROM request_history h
           JOIN users u ON u.id = h.user_id WHERE ${where}`,
        filters
      )
    ).rows[0].count;

    const { rows } = await pool.query(
      `SELECT h.id, h.request_id, u.external_id, h.units, h.accepted,
              h.rejected_level, h.rejected_rule, h.usage_month, h.details, h.created_at
         FROM request_history h
         JOIN users u ON u.id = h.user_id
        WHERE ${where}
        ORDER BY h.id DESC
        LIMIT $5 OFFSET $6`,
      [...filters, q.pageSize, (q.page - 1) * q.pageSize]
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        externalId: row.external_id,
        units: row.units,
        accepted: row.accepted,
        rejection: row.accepted
          ? null
          : {
              level: row.rejected_level,
              rule: row.rejected_rule,
              message: row.details.message,
            },
        month: row.usage_month,
        createdAt: row.created_at,
        details: row.details,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  })
);