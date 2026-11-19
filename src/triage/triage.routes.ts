import { Router } from "express";
import type { TriageService } from "./triage.service.js";
import { parseOrThrow, patientIdSchema, registerPatientSchema } from "./triage.validation.js";

/** HTTP only: read the request, call the service, send the response. */
export function createTriageRouter(service: TriageService) {
  const router = Router();

  router.post("/patients", (req, res) => {
    const input = parseOrThrow(registerPatientSchema, req.body);
    const patient = service.registerPatient(input);

    res.status(201).location(`/patients/${patient.id}`).json(patient);
  });

  router.get("/patients/:id", (req, res) => {
    const id = parseOrThrow(patientIdSchema, req.params.id, "id");

    res.json(service.getPatient(id));
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
