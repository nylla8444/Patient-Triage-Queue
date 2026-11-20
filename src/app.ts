import express from "express";
import type { Db } from "./db/connection.js";
import { errorHandler, methodNotAllowed, notFoundHandler } from "./middleware/errorHandler.js";
import { createPatientRepository } from "./triage/triage.repository.js";
import { createTriageRouter } from "./triage/triage.routes.js";
import { createTriageService, type Clock } from "./triage/triage.service.js";

export interface AppOptions {
  /** Defaults to the real time. Tests pass a fixed clock. */
  now?: Clock;
}

export function createApp(db: Db, options: AppOptions = {}) {
  const app = express();

  // The largest valid request body is well under 1 KB (all fields at max length),
  // so 10 KB leaves room while refusing oversized bodies early (D27).
  app.use(express.json({ limit: "10kb" }));

  // Reports whether the API can actually reach its database, not just whether it's running.
  app
    .route("/health")
    .get((_req, res) => {
      try {
        db.prepare("SELECT 1").get();
        res.json({ status: "ok", database: "ok" });
      } catch {
        res.status(503).json({ status: "error", database: "unavailable" });
      }
    })
    .all(methodNotAllowed("GET"));

  const service = createTriageService(createPatientRepository(db), options.now);
  app.use(createTriageRouter(service));

  // Must come after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
