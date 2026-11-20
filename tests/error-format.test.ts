import request, { type Response } from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = createApp(db);
  // Patient 1, WAITING: used by the 409 cases.
  await request(app)
    .post("/patients")
    .send({ fullName: "Ana Cruz", complaint: "abdominal pain", triageLevel: 3 })
    .expect(201);
});

afterEach(() => {
  db.close();
});

/**
 * The API's error contract (PLAN §7): JSON, exactly { error: { code, message, details? } },
 * details (if any) are { field, message }, and nothing internal such as a stack trace.
 */
function expectStandardError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toMatch(/^application\/json/);
  expect(Object.keys(res.body)).toEqual(["error"]);

  const { error } = res.body;
  expect(Object.keys(error).sort()).toEqual(
    error.details ? ["code", "details", "message"] : ["code", "message"],
  );
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  expect(error.message.length).toBeGreaterThan(0);

  for (const detail of error.details ?? []) {
    expect(Object.keys(detail).sort()).toEqual(["field", "message"]);
  }

  expect(JSON.stringify(res.body)).not.toMatch(/\.(ts|js):\d+|node_modules|sqlite/i);
}

const json = { "Content-Type": "application/json" };

type Case = [label: string, send: () => request.Test, status: number, code: string];

const cases: Case[] = [
  // 400: the request itself is wrong
  ["body fails validation", () => request(app).post("/patients").send({}), 400, "VALIDATION_ERROR"],
  ["broken JSON", () => request(app).post("/patients").set(json).send('{"fullName":'), 400, "VALIDATION_ERROR"],
  ["JSON sent as text/plain", () => request(app).post("/patients").set("Content-Type", "text/plain").send('{"fullName":"Ana"}'), 400, "VALIDATION_ERROR"],
  ["id not a number", () => request(app).get("/patients/abc"), 400, "VALIDATION_ERROR"],
  ["id too large to be exact", () => request(app).get("/patients/99999999999999999999"), 400, "VALIDATION_ERROR"],
  ["bad status filter", () => request(app).get("/patients?status=waiting"), 400, "VALIDATION_ERROR"],
  ["bad re-triage body", () => request(app).patch("/patients/1/triage").send({ triageLevel: 9 }), 400, "VALIDATION_ERROR"],
  ["bad status body", () => request(app).patch("/patients/1/status").send({ status: "IN_TREATMENT" }), 400, "VALIDATION_ERROR"],
  ["malformed URL encoding", () => request(app).get("/patients/%E0%A4%A"), 400, "BAD_REQUEST"],

  // 404: nothing there
  ["unknown route", () => request(app).get("/nope"), 404, "NOT_FOUND"],
  ["unknown patient", () => request(app).get("/patients/999"), 404, "NOT_FOUND"],
  ["re-triage unknown patient", () => request(app).patch("/patients/999/triage").send({ triageLevel: 2 }), 404, "NOT_FOUND"],
  ["close visit of unknown patient", () => request(app).patch("/patients/999/status").send({ status: "LEFT" }), 404, "NOT_FOUND"],

  // 405: the path exists, the method doesn't
  ["DELETE a patient (never deleted, D9)", () => request(app).delete("/patients/1"), 405, "METHOD_NOT_ALLOWED"],
  ["PUT /patients", () => request(app).put("/patients").send({}), 405, "METHOD_NOT_ALLOWED"],
  ["GET /queue/next (POST only)", () => request(app).get("/queue/next"), 405, "METHOD_NOT_ALLOWED"],
  ["POST /queue", () => request(app).post("/queue"), 405, "METHOD_NOT_ALLOWED"],
  ["GET /patients/1/status", () => request(app).get("/patients/1/status"), 405, "METHOD_NOT_ALLOWED"],
  ["POST /health", () => request(app).post("/health"), 405, "METHOD_NOT_ALLOWED"],

  // 409: valid request, wrong moment for this patient
  ["mark a WAITING patient DONE", () => request(app).patch("/patients/1/status").send({ status: "DONE" }), 409, "INVALID_TRANSITION"],

  // 413 / 415: body the server won't read
  ["body over 10 KB", () => request(app).post("/patients").set(json).send(JSON.stringify({ fullName: "a".repeat(11_000) })), 413, "PAYLOAD_TOO_LARGE"],
  ["unsupported charset", () => request(app).post("/patients").set("Content-Type", "application/json; charset=latin1").send("{}"), 415, "UNSUPPORTED_MEDIA_TYPE"],
];

describe("every error uses the same format", () => {
  const titled = cases.map(([label, send, status, code]) => [`${label} → ${status} ${code}`, send, status, code] as const);

  it.each(titled)("%s", async (_title, send, status, code) => {
    expectStandardError(await send(), status, code);
  });
});

describe("specific error details", () => {
  it("405 tells the client which methods are allowed", async () => {
    const del = await request(app).delete("/patients/1");
    const next = await request(app).get("/queue/next");
    const put = await request(app).put("/patients");

    expect(del.headers.allow).toBe("GET, HEAD");
    expect(del.body.error.message).toBe("DELETE is not allowed on /patients/1. Allowed: GET, HEAD");
    expect(next.headers.allow).toBe("POST");
    expect(put.headers.allow).toBe("GET, POST, HEAD");
  });

  it("OPTIONS answers 204 with the Allow header instead of an error", async () => {
    const res = await request(app).options("/patients");

    expect(res.status).toBe(204);
    expect(res.headers.allow).toBe("GET, POST, HEAD");
  });

  it("HEAD still works on GET routes", async () => {
    expect((await request(app).head("/queue")).status).toBe(200);
  });

  it("a too-large id is reported as too large, not as a different id", async () => {
    const res = await request(app).get("/patients/99999999999999999999");

    expect(res.body.error.details).toEqual([{ field: "id", message: "id is too large" }]);
  });

  it("the largest valid id still works normally", async () => {
    const res = await request(app).get(`/patients/${Number.MAX_SAFE_INTEGER}`);

    expect(res.status).toBe(404); // valid id, just no such patient
  });

  it("a body sent as text/plain gets a hint about Content-Type", async () => {
    const res = await request(app)
      .post("/patients")
      .set("Content-Type", "text/plain")
      .send('{"fullName":"Ana","complaint":"x","triageLevel":3}');

    expect(res.body.error.message).toBe(
      "Request body must be a JSON object, sent with Content-Type: application/json",
    );
  });

  it("413 says what the limit is", async () => {
    const res = await request(app)
      .post("/patients")
      .set(json)
      .send(JSON.stringify({ fullName: "a".repeat(11_000) }));

    expect(res.body.error.message).toBe("Request body is too large (max 10240 bytes)");
  });

  it("doesn't advertise the framework in response headers", async () => {
    const ok = await request(app).get("/health");
    const error = await request(app).get("/nope");

    expect(ok.headers["x-powered-by"]).toBeUndefined();
    expect(error.headers["x-powered-by"]).toBeUndefined();
  });

  it("a normal body with every field at its maximum length is still accepted", async () => {
    const res = await request(app)
      .post("/patients")
      .send({ fullName: "a".repeat(100), age: 130, complaint: "a".repeat(500), triageLevel: 5 });

    expect(res.status).toBe(201);
  });
});
