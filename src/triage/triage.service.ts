import { notFound } from "../errors.js";
import type { PatientRepository } from "./triage.repository.js";
import type { Patient } from "./triage.types.js";
import type { RegisterPatientInput } from "./triage.validation.js";

/** Returns the current time. Tests pass a fixed clock so timestamps are predictable. */
export type Clock = () => Date;

/** Business rules. Knows nothing about HTTP or SQL. */
export function createTriageService(patients: PatientRepository, now: Clock = () => new Date()) {
  return {
    /** New patients always start as WAITING, with the server's time as arrival (PLAN §4). */
    registerPatient(input: RegisterPatientInput): Patient {
      return patients.insert({
        fullName: input.fullName,
        age: input.age ?? null,
        complaint: input.complaint,
        triageLevel: input.triageLevel as Patient["triageLevel"],
        arrivedAt: now().toISOString(),
      });
    },

    getPatient(id: number): Patient {
      const patient = patients.findById(id);
      if (!patient) throw notFound(`Patient ${id} not found`);
      return patient;
    },
  };
}

export type TriageService = ReturnType<typeof createTriageService>;
