import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";

function at(time: string): Date {
  return new Date(`2026-11-20T${time}:00.000Z`);
}

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: Date;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = at("08:00");
  app = createApp(db, { now: () => clock });
});

afterEach(() => {
  db.close();
});

async function arrive(time: string, fullName: string, triageLevel = 3): Promise<number> {
  clock = at(time);
  const res = await request(app)
    .post("/patients")
    .send({ fullName, complaint: "test complaint", triageLevel })
    .expect(201);
  return res.body.id;
}

async function callNext(time: string) {
  clock = at(time);
  return request(app).post("/queue/next").expect(200);
}

function setStatus(id: number | string, body: unknown, time = "09:00") {
  clock = at(time);
  return request(app).patch(`/patients/${id}/status`).send(body as object);
}

/** Puts a new patient into the given status using only the real endpoints. */
async function patientWithStatus(status: string): Promise<number> {
  const id = await arrive("08:00", "Ana");
  if (status === "WAITING") return id;
  await callNext("08:10");
  if (status === "IN_TREATMENT") return id;
  await setStatus(id, { status: "DONE" }).expect(200);
  return id;
}

describe("PATCH /patients/:id/status", () => {
  it("IN_TREATMENT → DONE: treatment finished, finishedAt set, calledAt kept", async () => {
    const id = await arrive("08:00", "Ana");
    await callNext("08:10");

    const res = await setStatus(id, { status: "DONE" }, "08:40");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: "DONE",
      arrivedAt: "2026-11-20T08:00:00.000Z",
      calledAt: "2026-11-20T08:10:00.000Z",
      finishedAt: "2026-11-20T08:40:00.000Z",
    });
  });

  it("WAITING → LEFT: walked out before being seen, never called", async () => {
    const id = await arrive("08:00", "Ana");

    const res = await setStatus(id, { status: "LEFT" }, "08:25");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "LEFT",
      calledAt: null,
      finishedAt: "2026-11-20T08:25:00.000Z",
    });
  });

  it("a patient who LEFT disappears from the queue and can't be called", async () => {
    const ana = await arrive("08:00", "Ana", 2);
    await arrive("08:01", "Ben", 3);

    await setStatus(ana, { status: "LEFT" }).expect(200);

    const queue = await request(app).get("/queue");
    expect(queue.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(["Ben"]);
    const called = await request(app).post("/queue/next");
    expect(called.body.fullName).toBe("Ben");
  });

  it("keeps the record: closed visits are still listed (never deleted, D9)", async () => {
    const ana = await arrive("08:00", "Ana");
    const ben = await arrive("08:01", "Ben");
    await callNext("08:10"); // Ana
    await setStatus(ana, { status: "DONE" }).expect(200);
    await setStatus(ben, { status: "LEFT" }).expect(200);

    const all = await request(app).get("/patients");
    const done = await request(app).get("/patients?status=DONE");

    expect(all.body.count).toBe(2);
    expect(done.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(["Ana"]);
  });

  it("full day: arrive → called → done, and arrive → left", async () => {
    const ana = await arrive("08:00", "Ana", 2);
    const ben = await arrive("08:05", "Ben", 4);

    await callNext("08:10");
    await setStatus(ana, { status: "DONE" }, "08:30").expect(200);
    await setStatus(ben, { status: "LEFT" }, "08:45").expect(200);

    const statuses = (await request(app).get("/patients")).body.data.map(
      (p: { fullName: string; status: string }) => `${p.fullName}:${p.status}`,
    );
    expect(statuses).toEqual(["Ana:DONE", "Ben:LEFT"]);
    expect((await request(app).get("/queue")).body.count).toBe(0);
  });
});

describe("only the allowed moves (PLAN §6)", () => {
  it.each([
    ["WAITING", "DONE", "IN_TREATMENT"], // never seen, can't be done
    ["IN_TREATMENT", "LEFT", "WAITING"], // already with a doctor, didn't walk out
    ["DONE", "DONE", "IN_TREATMENT"], // already closed
    ["DONE", "LEFT", "WAITING"],
  ])("refuses %s → %s with 409 and changes nothing", async (from, to, required) => {
    const id = await patientWithStatus(from);
    const before = (await request(app).get(`/patients/${id}`)).body;

    const res = await setStatus(id, { status: to }, "10:00");

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "INVALID_TRANSITION",
      message: `Patient ${id} is ${from}; only ${required} patients can be marked ${to}`,
    });
    expect((await request(app).get(`/patients/${id}`)).body).toEqual(before);
  });

  it.each(["DONE", "LEFT"])("refuses LEFT → %s with 409", async (to) => {
    const id = await arrive("08:00", "Ana");
    await setStatus(id, { status: "LEFT" }).expect(200);

    const res = await setStatus(id, { status: to });

    expect(res.status).toBe(409);
  });

  it("returns 404 for a patient that doesn't exist", async () => {
    const res = await setStatus(42, { status: "DONE" });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Patient 42 not found" });
  });
});

describe("status validation", () => {
  it.each([
    ["IN_TREATMENT (only via call-next)", { status: "IN_TREATMENT" }],
    ["WAITING (no going back)", { status: "WAITING" }],
    ["lowercase done", { status: "done" }],
    ["missing", {}],
    ["a number", { status: 1 }],
  ])("rejects %s with 400", async (_label, body) => {
    const id = await patientWithStatus("IN_TREATMENT");

    const res = await setStatus(id, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      {
        field: "status",
        message: "status must be DONE or LEFT (patients go to IN_TREATMENT through POST /queue/next)",
      },
    ]);
  });

  it("rejects a bad id with 400", async () => {
    const res = await setStatus("abc", { status: "DONE" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("id");
  });

  it("rejects a body that isn't a JSON object", async () => {
    const id = await patientWithStatus("IN_TREATMENT");

    const res = await setStatus(id, ["DONE"]);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      "Request body must be a JSON object, sent with Content-Type: application/json",
    );
  });
});
