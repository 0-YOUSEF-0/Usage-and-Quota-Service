import { Pool, types } from "pg";
      // postgres bigint comes as a string
 // our unit counts are small enough to use numbers
types.setTypeParser(20, (value) => parseInt(value, 10));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export const pool = new Pool({ connectionString });

pool.on("error", (err) => {
  console.error("Unexpected database error on idle client", err);
});