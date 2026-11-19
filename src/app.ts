import express from "express";
import type { Db } from "./db/connection.js";

export function createApp(db: Db) {
  const app = express();

  app.use(express.json());

  // Reports whether the API can actually reach its database, not just whether it's running.
  app.get("/health", (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", database: "ok" });
    } catch {
      res.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  return app;
}
