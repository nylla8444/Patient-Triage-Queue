import { z } from "zod";
import { validationError } from "../errors.js";
import { PATIENT_STATUSES } from "./triage.types.js";

/**
 * Body of POST /patients. Fields the client must not control (id, status, arrivedAt)
 * are not listed, so Zod drops them if they are sent.
 * Numbers must be real JSON numbers: "3" is rejected rather than guessed at.
 */
export const registerPatientSchema = z.object(
  {
    fullName: z
      .string({ error: "fullName is required and must be text" })
      .trim()
      .min(1, "fullName cannot be empty")
      .max(100, "fullName must be at most 100 characters"),
    age: z
      .number({ error: "age must be a number" })
      .int("age must be a whole number")
      .min(0, "age must be between 0 and 130")
      .max(130, "age must be between 0 and 130")
      .nullish(),
    complaint: z
      .string({ error: "complaint is required and must be text" })
      .trim()
      .min(1, "complaint cannot be empty")
      .max(500, "complaint must be at most 500 characters"),
    triageLevel: z
      .number({ error: "triageLevel is required and must be a number from 1 to 5" })
      .int("triageLevel must be a whole number from 1 to 5")
      .min(1, "triageLevel must be between 1 and 5")
      .max(5, "triageLevel must be between 1 and 5"),
  },
  { error: "Request body must be a JSON object" },
);

export type RegisterPatientInput = z.output<typeof registerPatientSchema>;

/** Route parameter :id, e.g. /patients/12. Rejects "abc", "0", "-1", "1.5". */
export const patientIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "id must be a positive whole number")
  .transform(Number);

/**
 * Query string of GET /patients. ?status is optional; without it, everyone is listed.
 * Must match exactly (e.g. "waiting" is rejected), same as the strict body rules (D18).
 */
export const listPatientsQuerySchema = z.object({
  status: z
    .enum(PATIENT_STATUSES, { error: `status must be one of ${PATIENT_STATUSES.join(", ")}` })
    .optional(),
});

/**
 * Checks a value against a schema and returns the clean, typed result,
 * or throws a 400 listing every problem (not just the first one).
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, label = "body"): z.output<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : label,
      message: issue.message,
    }));
    throw validationError(details[0]?.message ?? "Invalid request", details);
  }

  return result.data;
}
