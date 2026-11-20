import { Router } from "express";
import { methodNotAllowed } from "../middleware/errorHandler.js";
import type { TriageService } from "./triage.service.js";
import type { TriageLevel } from "./triage.types.js";
import {
  closeVisitSchema,
  listPatientsQuerySchema,
  parseOrThrow,
  patientIdSchema,
  registerPatientSchema,
  retriageSchema,
} from "./triage.validation.js";

/**
 * HTTP only: read the request, call the service, send the response.
 * Each path lists its methods, then methodNotAllowed answers any other method with 405.
 */
export function createTriageRouter(service: TriageService) {
  const router = Router();

  router
    .route("/patients")
    .get((req, res) => {
      const { status } = parseOrThrow(listPatientsQuerySchema, req.query, "query");
      const patients = service.listPatients(status);

      res.json({ count: patients.length, data: patients });
    })
    .post((req, res) => {
      const input = parseOrThrow(registerPatientSchema, req.body);
      const patient = service.registerPatient(input);

      res.status(201).location(`/patients/${patient.id}`).json(patient);
    })
    .all(methodNotAllowed("GET", "POST"));

  router
    .route("/patients/:id")
    .get((req, res) => {
      const id = parseOrThrow(patientIdSchema, req.params.id, "id");

      res.json(service.getPatient(id));
    })
    // No DELETE on purpose: records are never deleted (D9).
    .all(methodNotAllowed("GET"));

  router
    .route("/patients/:id/triage")
    .patch((req, res) => {
      const id = parseOrThrow(patientIdSchema, req.params.id, "id");
      const { triageLevel } = parseOrThrow(retriageSchema, req.body);

      res.json(service.retriage(id, triageLevel as TriageLevel));
    })
    .all(methodNotAllowed("PATCH"));

  router
    .route("/patients/:id/status")
    .patch((req, res) => {
      const id = parseOrThrow(patientIdSchema, req.params.id, "id");
      const { status } = parseOrThrow(closeVisitSchema, req.body);

      res.json(service.closeVisit(id, status));
    })
    .all(methodNotAllowed("PATCH"));

  router
    .route("/queue")
    .get((_req, res) => {
      const queue = service.getQueue();

      res.json({ count: queue.length, data: queue });
    })
    .all(methodNotAllowed("GET"));

  router
    .route("/queue/next")
    .post((_req, res) => {
      const patient = service.callNext();

      if (!patient) {
        // Empty queue: the request worked, there's just nobody to call (D10).
        res.status(204).end();
        return;
      }

      res.json(patient);
    })
    .all(methodNotAllowed("POST"));

  return router;
}
