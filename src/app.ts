import express from "express";
import { pool } from "./database/pool";
import { errorHandler, notFoundHandler } from "./http/errors";
import { accountsRouter } from "./routes/accounts";
import { usersRouter } from "./routes/users";
import { plansRouter } from "./routes/plans";
import { consumeRouter } from "./routes/consume";
import { reportsRouter } from "./routes/reports";

const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "up" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

app.use(accountsRouter);
app.use("/users", usersRouter);
app.use("/plans", plansRouter);
app.use(consumeRouter);
app.use(reportsRouter);


app.use(notFoundHandler);
app.use(errorHandler);

export default app;