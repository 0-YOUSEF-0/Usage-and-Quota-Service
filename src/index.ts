import app from "./app";
import { runMigrations } from "./database/migrate";

const PORT = Number(process.env.PORT) || 3000;

async function main(): Promise<void> {
  await runMigrations();

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});