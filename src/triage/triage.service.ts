import { notFound } from "../errors.js";
import type { PatientRepository } from "./triage.repository.js";
import type { Patient, QueueEntry } from "./triage.types.js";
import type { RegisterPatientInput } from "./triage.validation.js";

/** Returns the current time. Tests pass a fixed clock so timestamps are predictable. */
export type Clock = () => Date;

const MS_PER_MINUTE = 60_000;

/** Whole minutes between two moments, rounded down, never negative (e.g. if the server clock moved back). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE));
}

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

    /** Waiting patients in the order they will be seen, with their position and waiting time. */
    getQueue(): QueueEntry[] {
      const current = now();

      return patients.findWaitingInQueueOrder().map((patient, index) => ({
        position: index + 1,
        ...patient,
        waitingMinutes: minutesBetween(new Date(patient.arrivedAt), current),
      }));
    },
  };
}

export type TriageService = ReturnType<typeof createTriageService>;
