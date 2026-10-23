import { Pool, types } from "pg";

// bigint (type id 20) arrives as a string by default. Our values are far below 2^53.
types.setTypeParser(20, (value) => parseInt(value, 10));
// date (type id 1082) would become a JS Date in local time. Keep it as "YYYY-MM-DD".
types.setTypeParser(1082, (value) => value);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX) || 10,
});

pool.on("error", (err) => {
  console.error("Unexpected database error on idle client", err);
});