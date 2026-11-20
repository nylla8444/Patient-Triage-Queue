import { Router } from "express";
import type { TriageService } from "./triage.service.js";
import {
  listPatientsQuerySchema,
  parseOrThrow,
  patientIdSchema,
  registerPatientSchema,
  retriageSchema,
} from "./triage.validation.js";
import type { TriageLevel } from "./triage.types.js";

/** HTTP only: read the request, call the service, send the response. */
export function createTriageRouter(service: TriageService) {
  const router = Router();

  router.post("/patients", (req, res) => {
    const input = parseOrThrow(registerPatientSchema, req.body);
    const patient = service.registerPatient(input);

    res.status(201).location(`/patients/${patient.id}`).json(patient);
  });

  router.get("/patients", (req, res) => {
    const { status } = parseOrThrow(listPatientsQuerySchema, req.query, "query");
    const patients = service.listPatients(status);

    res.json({ count: patients.length, data: patients });
  });

  router.get("/patients/:id", (req, res) => {
    const id = parseOrThrow(patientIdSchema, req.params.id, "id");

    res.json(service.getPatient(id));
  });

  router.patch("/patients/:id/triage", (req, res) => {
    const id = parseOrThrow(patientIdSchema, req.params.id, "id");
    const { triageLevel } = parseOrThrow(retriageSchema, req.body);

    res.json(service.retriage(id, triageLevel as TriageLevel));
  });

  router.get("/queue", (_req, res) => {
    const queue = service.getQueue();

    res.json({ count: queue.length, data: queue });
  });

  router.post("/queue/next", (_req, res) => {
    const patient = service.callNext();

    if (!patient) {
      // Empty queue: the request worked, there's just nobody to call (D10).
      res.status(204).end();
      return;
    }

    res.json(patient);
  });

  return router;
}
