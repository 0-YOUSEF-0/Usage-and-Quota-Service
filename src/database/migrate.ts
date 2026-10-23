import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
const MIGRATION_LOCK_ID  = 727274;

export async function runMigrations(): Promise<void> {
    const client =await pool.connect();

     try {
        // stop two app instances from running migrations at the same time
        await client.query("SELECT pg_advisory_lock($1)", [
            MIGRATION_LOCK_ID
         ] );

        // create a table to remember which migrations already ran
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `  );

        // get the migrations that already ran
        const result = await client.query (
            "SELECT filename FROM schema_migrations"
        );

        const applied = new Set(
            result.rows.map((row) => row.filename)
        );

        // get all sql files from the migrations folder
        const files = (await fs.readdir(MIGRATIONS_DIR))
            .filter((file) => file.endsWith(".sql"))
            .sort();

        // run only the migrations that didn't run before
        for (const file of files) {
            if (applied.has(file)) continue ;

            const sql = await fs.readFile(
                path.join(MIGRATIONS_DIR, file),
                "utf8"
            );

            try {
                // start a transaction
                await client.query("BEGIN");
                await client.query(sql);

                   
                await client.query(        // save the migration name after it runs
                    "INSERT INTO schema_migrations (filename) VALUES ($1)",
                    [file]
                );

                  
                await client.query("COMMIT");     // save all changes

                console.log(`Applied migration: ${file}`);
            } catch (error) {
                // cancel changes if the migration failed
                await client.query("ROLLBACK");

                throw new Error(
                    `Migration ${file} failed: ${(error as Error).message}`
                );
            }
        }
    }  finally {
        try   {
                // release the migration lock
            await client.query("SELECT pg_advisory_unlock($1)", [
                MIGRATION_LOCK_ID
            ]) ;
        } finally {
               // return the connection to the pool
            client.release();
        }
    }
}
