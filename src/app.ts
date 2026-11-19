import express from "express";
import type { Db } from "./db/connection.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createPatientRepository } from "./triage/triage.repository.js";
import { createTriageRouter } from "./triage/triage.routes.js";
import { createTriageService, type Clock } from "./triage/triage.service.js";

export interface AppOptions {
  /** Defaults to the real time. Tests pass a fixed clock. */
  now?: Clock;
}

export function createApp(db: Db, options: AppOptions = {}) {
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

  const service = createTriageService(createPatientRepository(db), options.now);
  app.use(createTriageRouter(service));

  // Must come after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
