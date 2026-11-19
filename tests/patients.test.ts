import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";

const FIXED_NOW = new Date("2026-11-20T08:00:00.000Z");

const validBody = {
  fullName: "Ana Cruz",
  age: 34,
  complaint: "abdominal pain",
  triageLevel: 3,
};

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp(db, { now: () => FIXED_NOW });
});

afterEach(() => {
  if (db.open) db.close();
  vi.restoreAllMocks();
});

function countPatients(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number };
  return row.count;
}

describe("POST /patients", () => {
  it("registers a patient as WAITING with the server's arrival time", async () => {
    const res = await request(app).post("/patients").send(validBody);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe("/patients/1");
    expect(res.body).toEqual({
      id: 1,
      fullName: "Ana Cruz",
      age: 34,
      complaint: "abdominal pain",
      triageLevel: 3,
      status: "WAITING",
      arrivedAt: "2026-11-20T08:00:00.000Z",
      calledAt: null,
      finishedAt: null,
    });
  });

  it("saves the patient in the database", async () => {
    await request(app).post("/patients").send(validBody);

    expect(countPatients()).toBe(1);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
  ])("accepts %s age and stores it as null", async (_label, age) => {
    const res = await request(app).post("/patients").send({ ...validBody, age });

    expect(res.status).toBe(201);
    expect(res.body.age).toBeNull();
  });

  it("trims spaces around text fields", async () => {
    const res = await request(app)
      .post("/patients")
      .send({ ...validBody, fullName: "  Ana Cruz  ", complaint: " chest pain " });

    expect(res.body.fullName).toBe("Ana Cruz");
    expect(res.body.complaint).toBe("chest pain");
  });

  it("ignores fields the client must not control (id, status, arrivedAt)", async () => {
    const res = await request(app)
      .post("/patients")
      .send({
        ...validBody,
        id: 999,
        status: "IN_TREATMENT",
        arrivedAt: "2020-01-01T00:00:00.000Z", // trying to jump the queue by back-dating
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.status).toBe("WAITING");
    expect(res.body.arrivedAt).toBe("2026-11-20T08:00:00.000Z");
  });

  it.each([
    ["fullName missing", { fullName: undefined }, "fullName"],
    ["fullName only spaces", { fullName: "   " }, "fullName"],
    ["fullName too long", { fullName: "a".repeat(101) }, "fullName"],
    ["fullName not text", { fullName: 42 }, "fullName"],
    ["complaint missing", { complaint: undefined }, "complaint"],
    ["complaint empty", { complaint: "" }, "complaint"],
    ["complaint too long", { complaint: "a".repeat(501) }, "complaint"],
    ["triageLevel missing", { triageLevel: undefined }, "triageLevel"],
    ["triageLevel 0", { triageLevel: 0 }, "triageLevel"],
    ["triageLevel 6", { triageLevel: 6 }, "triageLevel"],
    ["triageLevel 2.5", { triageLevel: 2.5 }, "triageLevel"],
    ['triageLevel "high"', { triageLevel: "high" }, "triageLevel"],
    ['triageLevel "3" (string)', { triageLevel: "3" }, "triageLevel"],
    ["age -1", { age: -1 }, "age"],
    ["age 131", { age: 131 }, "age"],
    ["age 30.5", { age: 30.5 }, "age"],
    ['age "30" (string)', { age: "30" }, "age"],
  ])("rejects %s with 400", async (_label, change, field) => {
    const res = await request(app)
      .post("/patients")
      .send({ ...validBody, ...change });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([expect.objectContaining({ field })]);
    expect(countPatients()).toBe(0);
  });

  it("lists every invalid field, not only the first", async () => {
    const res = await request(app).post("/patients").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual([
      "fullName",
      "complaint",
      "triageLevel",
    ]);
  });

  it("explains the triage level rule in the error message", async () => {
    const res = await request(app)
      .post("/patients")
      .send({ ...validBody, triageLevel: 6 });

    expect(res.body.error.message).toBe("triageLevel must be between 1 and 5");
  });

  it("rejects broken JSON with 400 instead of crashing", async () => {
    const res = await request(app)
      .post("/patients")
      .set("Content-Type", "application/json")
      .send('{"fullName": "Ana", ');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Request body is not valid JSON",
    });
  });

  it.each([
    ["a JSON array", [validBody]],
    ["no body", undefined],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app).post("/patients").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Request body must be a JSON object");
  });
});

describe("GET /patients/:id", () => {
  it("returns the registered patient", async () => {
    const created = await request(app).post("/patients").send(validBody);

    const res = await request(app).get(`/patients/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it("returns 404 for an id that doesn't exist", async () => {
    const res = await request(app).get("/patients/42");

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Patient 42 not found" });
  });

  it.each(["abc", "0", "-1", "1.5", "1e3"])("returns 400 for id %s", async (id) => {
    const res = await request(app).get(`/patients/${id}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([
      { field: "id", message: "id must be a positive whole number" },
    ]);
  });
});

describe("error responses", () => {
  it("answers unknown routes with the standard JSON error", async () => {
    const res = await request(app).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Route GET /nope not found" });
  });

  it("hides internal details when something unexpected fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    db.close(); // simulate the database going away mid-flight

    const res = await request(app).post("/patients").send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/database|sqlite|stack/i);
    expect(logged).toHaveBeenCalledOnce(); // the real cause is still logged for us
  });
});
