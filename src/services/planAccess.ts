import { pool } from "../database/pool";
import { HttpError } from "../http/errors";

export async function assertPlanAssignable(
  accountId: string,
  planId: string
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM plans
      WHERE id = $1 AND (account_id IS NULL OR account_id = $2)`,
    [planId, accountId]
  );

  if (rows.length === 0) {
    throw new HttpError(
      400,
      "invalid_plan",
      "The plan does not exist or is not available to this account."
    );
  }
}