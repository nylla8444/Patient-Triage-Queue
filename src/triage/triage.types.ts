/** 1 = most urgent (Resuscitation) … 5 = least urgent (Non-urgent). See D4. */
export type TriageLevel = 1 | 2 | 3 | 4 | 5;

/** Every status a patient can have, in lifecycle order (PLAN §6). */
export const PATIENT_STATUSES = ["WAITING", "IN_TREATMENT", "DONE", "LEFT"] as const;

export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/**
 * The two ways a visit ends, and the only status each one may come from (PLAN §6, D9):
 * - DONE: treatment finished, so the patient must be IN_TREATMENT
 * - LEFT: walked out before being seen, so the patient must be WAITING
 * IN_TREATMENT itself is only reachable through POST /queue/next.
 */
export const CLOSE_VISIT_FROM = { DONE: "IN_TREATMENT", LEFT: "WAITING" } as const;

export type ClosingStatus = keyof typeof CLOSE_VISIT_FROM;

export const CLOSING_STATUSES = ["DONE", "LEFT"] as const satisfies readonly ClosingStatus[];

/** A patient as the API returns it (camelCase). The database uses snake_case. */
export interface Patient {
  id: number;
  fullName: string;
  age: number | null;
  complaint: string;
  triageLevel: TriageLevel;
  status: PatientStatus;
  arrivedAt: string;
  calledAt: string | null;
  finishedAt: string | null;
}

/**
 * A patient as shown in GET /queue. position and waitingMinutes are calculated
 * on every request, never stored, so they can't go stale (PLAN §7).
 */
export interface QueueEntry extends Patient {
  /** 1 = seen next. */
  position: number;
  /** Whole minutes since arrival, rounded down. */
  waitingMinutes: number;
}
