import type { Db } from "../db/connection.js";
import type { ClosingStatus, Patient, PatientStatus, TriageLevel } from "./triage.types.js";

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

export interface CloseVisitRecord {
  id: number;
  newStatus: ClosingStatus;
  requiredStatus: PatientStatus;
  finishedAt: string;
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
 *
 * Defined once and used by both "view the queue" and "call next", so the patient
 * at position 1 is always the one who gets called (D22).
 */
const QUEUE_ORDER = "ORDER BY triage_level ASC, arrived_at ASC, id ASC";

export const WAITING_QUEUE_SQL = `
  SELECT * FROM patients
  WHERE status = 'WAITING'
  ${QUEUE_ORDER}
`;

/**
 * Picks the next waiting patient AND marks them IN_TREATMENT in one statement (D8).
 * There is no gap between "choose" and "claim" where another request could take
 * the same patient. No row returned = the queue is empty.
 */
export const CALL_NEXT_SQL = `
  UPDATE patients
  SET status = 'IN_TREATMENT', called_at = ?
  WHERE id = (
    SELECT id FROM patients
    WHERE status = 'WAITING'
    ${QUEUE_ORDER}
    LIMIT 1
  )
  RETURNING *
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

  const callNextStatement = db.prepare<[string], PatientRow>(CALL_NEXT_SQL);

  // Registration order (id). This is NOT queue order: GET /queue is the place for that.
  const findAllStatement = db.prepare<[], PatientRow>("SELECT * FROM patients ORDER BY id");
  const findByStatusStatement = db.prepare<[PatientStatus], PatientRow>(
    "SELECT * FROM patients WHERE status = ? ORDER BY id",
  );

  // The status check is part of the UPDATE itself, so a patient who is called
  // at the same moment can't be re-triaged after leaving the queue (same idea as D8).
  // arrived_at is not touched: re-triage keeps the original arrival time (D6).
  const retriageStatement = db.prepare<{ id: number; triageLevel: TriageLevel }, PatientRow>(`
    UPDATE patients
    SET triage_level = @triageLevel
    WHERE id = @id AND status = 'WAITING'
    RETURNING *
  `);

  // Same pattern as re-triage (D25): the "is the patient in the right status?" check
  // is part of the UPDATE, so nothing can change the patient in between.
  const closeVisitStatement = db.prepare<CloseVisitRecord, PatientRow>(`
    UPDATE patients
    SET status = @newStatus, finished_at = @finishedAt
    WHERE id = @id AND status = @requiredStatus
    RETURNING *
  `);

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

    /** Moves the next waiting patient to IN_TREATMENT and returns them, or undefined if nobody is waiting. */
    claimNextWaiting(calledAt: string): Patient | undefined {
      const row = callNextStatement.get(calledAt);
      return row ? toPatient(row) : undefined;
    },

    /** Every patient ever registered (or only those with one status), oldest registration first. */
    findAll(status?: PatientStatus): Patient[] {
      const rows = status ? findByStatusStatement.all(status) : findAllStatement.all();
      return rows.map(toPatient);
    },

    /**
     * Changes the level of a WAITING patient. Returns undefined if the patient
     * doesn't exist or isn't waiting; the service works out which.
     */
    updateWaitingTriageLevel(id: number, triageLevel: TriageLevel): Patient | undefined {
      const row = retriageStatement.get({ id, triageLevel });
      return row ? toPatient(row) : undefined;
    },

    /**
     * Ends a visit if the patient is currently in requiredStatus. Returns undefined if the
     * patient doesn't exist or is in another status; the service works out which.
     */
    closeVisit(record: CloseVisitRecord): Patient | undefined {
      const row = closeVisitStatement.get(record);
      return row ? toPatient(row) : undefined;
    },
  };
}

export type PatientRepository = ReturnType<typeof createPatientRepository>;
