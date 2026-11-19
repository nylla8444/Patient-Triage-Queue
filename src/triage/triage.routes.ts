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

  return router;
}
