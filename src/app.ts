// this file will describe the routes and settings 
import express from "express";
const app =express();
app.use(express.json())
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
  });
export default app;
