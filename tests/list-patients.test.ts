import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: Date;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = new Date("2026-11-20T08:00:00.000Z");
  app = createApp(db, { now: () => clock });
});

afterEach(() => {
  db.close();
});

async function arrive(minute: number, fullName: string, triageLevel: number) {
  clock = new Date(`2026-11-20T08:${String(minute).padStart(2, "0")}:00.000Z`);
  await request(app).post("/patients").send({ fullName, complaint: "x", triageLevel }).expect(201);
}

const summary = (body: { data: { fullName: string; status: string }[] }) =>
  body.data.map((p) => `${p.fullName}:${p.status}`);

/** Ana(3) Ben(4) Carla(2) Dan(3), then call next twice → Carla and Ana are IN_TREATMENT. */
async function busyMorning() {
  await arrive(0, "Ana", 3);
  await arrive(1, "Ben", 4);
  await arrive(5, "Carla", 2);
  await arrive(7, "Dan", 3);
  await request(app).post("/queue/next").expect(200);
  await request(app).post("/queue/next").expect(200);
}

describe("GET /patients", () => {
  it("returns an empty list when nobody is registered", async () => {
    const res = await request(app).get("/patients");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, data: [] });
  });

  it("lists every patient, whatever their status, in registration order", async () => {
    await busyMorning();

    const res = await request(app).get("/patients");

    expect(res.body.count).toBe(4);
    expect(summary(res.body)).toEqual([
      "Ana:IN_TREATMENT",
      "Ben:WAITING",
      "Carla:IN_TREATMENT",
      "Dan:WAITING",
    ]);
  });

  it("returns the same patient objects as GET /patients/:id", async () => {
    await arrive(0, "Ana", 3);

    const list = await request(app).get("/patients");
    const one = await request(app).get("/patients/1");

    expect(list.body.data[0]).toEqual(one.body);
  });

  it("filters by ?status=IN_TREATMENT to show who is being treated", async () => {
    await busyMorning();

    const res = await request(app).get("/patients?status=IN_TREATMENT");

    expect(res.body.count).toBe(2);
    expect(summary(res.body)).toEqual(["Ana:IN_TREATMENT", "Carla:IN_TREATMENT"]);
  });

  it("?status=WAITING lists the same people as GET /queue, but in registration order, not queue order", async () => {
    await arrive(0, "Ana", 3);
    await arrive(1, "Ben", 4);
    await arrive(5, "Carla", 2);

    const waiting = await request(app).get("/patients?status=WAITING");
    const queue = await request(app).get("/queue");

    expect(waiting.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(["Ana", "Ben", "Carla"]);
    expect(queue.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(["Carla", "Ana", "Ben"]);
  });

  it("returns an empty list for a valid status nobody has yet", async () => {
    await busyMorning();

    const res = await request(app).get("/patients?status=DONE");

    expect(res.body).toEqual({ count: 0, data: [] });
  });

  it.each(["waiting", "FOO", ""])("rejects ?status=%s with 400", async (status) => {
    const res = await request(app).get(`/patients?status=${status}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "status must be one of WAITING, IN_TREATMENT, DONE, LEFT",
      details: [{ field: "status", message: "status must be one of WAITING, IN_TREATMENT, DONE, LEFT" }],
    });
  });

  it("rejects the same filter given twice (?status=A&status=B)", async () => {
    const res = await request(app).get("/patients?status=WAITING&status=DONE");

    expect(res.status).toBe(400);
  });

  it("ignores unknown query parameters", async () => {
    await arrive(0, "Ana", 3);

    const res = await request(app).get("/patients?sort=name&page=2");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
