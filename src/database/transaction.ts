import type { PoolClient } from "pg";
import { pool } from "./pool";

// Runs fn inside BEGIN ... COMMIT. Any error rolls everything back.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the connection may already be broken; the original error matters more
    }
    throw err;
  } finally {
    client.release();
  }
}

// Borrows one connection for a few queries, without a transaction.
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}