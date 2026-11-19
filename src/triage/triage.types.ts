/** 1 = most urgent (Resuscitation) … 5 = least urgent (Non-urgent). See D4. */
export type TriageLevel = 1 | 2 | 3 | 4 | 5;

export type PatientStatus = "WAITING" | "IN_TREATMENT" | "DONE" | "LEFT";

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
