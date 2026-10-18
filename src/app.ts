// this file will describe the routes and settings 
import express from "express";
import { pool } from "./database/pool"


const app =express();
app.use(express.json())
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

export default app;
