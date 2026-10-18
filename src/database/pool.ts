import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export const pool = new Pool({ connectionString });

pool.on("error", (err) => {
  console.error("Unexpected database error on idle client", err);
});