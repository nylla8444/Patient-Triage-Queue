import type { Db } from "../db/connection.js";
import type { Patient, PatientStatus, TriageLevel } from "./triage.types.js";

/** A row exactly as SQLite stores it. */
interface PatientRow {
  id: number;
  full_name: string;
  age: number | null;
  complaint: string;
  triage_level: number;
  status: string;
  arrived_at: string;
  called_at: string | null;
  finished_at: string | null;
}

export interface NewPatientRecord {
  fullName: string;
  age: number | null;
  complaint: string;
  triageLevel: TriageLevel;
  arrivedAt: string;
}

/** The only place that translates between database rows and API objects. */
function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    fullName: row.full_name,
    age: row.age,
    complaint: row.complaint,
    // Safe casts: the table's CHECK constraints only allow these values.
    triageLevel: row.triage_level as TriageLevel,
    status: row.status as PatientStatus,
    arrivedAt: row.arrived_at,
    calledAt: row.called_at,
    finishedAt: row.finished_at,
  };
}

/**
 * The queue ordering rule (PLAN §5, D3, D5): most urgent level first, then whoever
 * arrived first, then lowest id as a final tie-break. The ORDER BY matches the
 * idx_queue_order index column for column, so SQLite reads rows already sorted.
 */
export const WAITING_QUEUE_SQL = `
  SELECT * FROM patients
  WHERE status = 'WAITING'
  ORDER BY triage_level ASC, arrived_at ASC, id ASC
`;

/** All SQL for patients lives here. */
export function createPatientRepository(db: Db) {
  const insertStatement = db.prepare<NewPatientRecord, PatientRow>(`
    INSERT INTO patients (full_name, age, complaint, triage_level, arrived_at)
    VALUES (@fullName, @age, @complaint, @triageLevel, @arrivedAt)
    RETURNING *
  `);

  const findByIdStatement = db.prepare<[number], PatientRow>(
    "SELECT * FROM patients WHERE id = ?",
  );

  const waitingQueueStatement = db.prepare<[], PatientRow>(WAITING_QUEUE_SQL);

  return {
    insert(record: NewPatientRecord): Patient {
      const row = insertStatement.get(record);
      if (!row) throw new Error("INSERT ... RETURNING returned no row");
      return toPatient(row);
    },

    findById(id: number): Patient | undefined {
      const row = findByIdStatement.get(id);
      return row ? toPatient(row) : undefined;
    },

    /** Waiting patients, already in queue order. */
    findWaitingInQueueOrder(): Patient[] {
      return waitingQueueStatement.all().map(toPatient);
    },
  };
}

export type PatientRepository = ReturnType<typeof createPatientRepository>;
