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

async function arrive(time: string, fullName: string, triageLevel: number): Promise<number> {
  clock = at(time);
  const res = await request(app)
    .post("/patients")
    .send({ fullName, complaint: "test complaint", triageLevel })
    .expect(201);
  return res.body.id;
}

function retriage(id: number | string, body: unknown) {
  return request(app).patch(`/patients/${id}/triage`).send(body as object);
}

async function queueNames(): Promise<string[]> {
  const res = await request(app).get("/queue");
  return res.body.data.map((p: { fullName: string }) => p.fullName);
}

describe("PATCH /patients/:id/triage", () => {
  it("changes the level of a waiting patient and keeps everything else", async () => {
    const id = await arrive("08:00", "Ana", 3);
    clock = at("08:10");

    const res = await retriage(id, { triageLevel: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      fullName: "Ana",
      triageLevel: 2,
      status: "WAITING",
      arrivedAt: "2026-11-20T08:00:00.000Z", // kept, not reset to 08:10 (D6)
      calledAt: null,
    });
  });

  it("saves the change", async () => {
    const id = await arrive("08:00", "Ana", 3);
    await retriage(id, { triageLevel: 1 });

    const res = await request(app).get(`/patients/${id}`);

    expect(res.body.triageLevel).toBe(1);
  });

  it("D6: Ana gets worse (3 → 2) and moves ahead of Carla, because she has waited longer", async () => {
    const ana = await arrive("08:00", "Ana", 3);
    await arrive("08:01", "Ben", 4);
    await arrive("08:05", "Carla", 2);
    await arrive("08:07", "Dan", 3);
    expect(await queueNames()).toEqual(["Carla", "Ana", "Dan", "Ben"]);

    clock = at("08:10");
    await retriage(ana, { triageLevel: 2 }).expect(200);

    expect(await queueNames()).toEqual(["Ana", "Carla", "Dan", "Ben"]);
  });

  it("moves a patient back when their level is lowered", async () => {
    const carla = await arrive("08:05", "Carla", 2);
    await arrive("08:06", "Dan", 3);

    await retriage(carla, { triageLevel: 4 }).expect(200);

    expect(await queueNames()).toEqual(["Dan", "Carla"]);
  });

  it("call next then calls the re-triaged patient in their new place", async () => {
    await arrive("08:00", "Ana", 2);
    const ben = await arrive("08:01", "Ben", 4);

    await retriage(ben, { triageLevel: 1 }).expect(200);
    const called = await request(app).post("/queue/next");

    expect(called.body.fullName).toBe("Ben");
  });

  it("accepts the same level again (nothing changes, still 200)", async () => {
    const id = await arrive("08:00", "Ana", 3);

    const res = await retriage(id, { triageLevel: 3 });

    expect(res.status).toBe(200);
    expect(res.body.triageLevel).toBe(3);
  });

  it("only changes the level, even if other fields are sent", async () => {
    const id = await arrive("08:00", "Ana", 3);

    const res = await retriage(id, {
      triageLevel: 2,
      fullName: "Someone Else",
      status: "DONE",
      arrivedAt: "2020-01-01T00:00:00.000Z",
    });

    expect(res.body).toMatchObject({
      fullName: "Ana",
      triageLevel: 2,
      status: "WAITING",
      arrivedAt: "2026-11-20T08:00:00.000Z",
    });
  });
});

describe("re-triage is only for WAITING patients", () => {
  it("returns 409 for a patient already in treatment, and changes nothing", async () => {
    const id = await arrive("08:00", "Ana", 3);
    await request(app).post("/queue/next").expect(200);

    const res = await retriage(id, { triageLevel: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "INVALID_TRANSITION",
      message: `Patient ${id} is IN_TREATMENT; only WAITING patients can be re-triaged`,
    });
    const after = await request(app).get(`/patients/${id}`);
    expect(after.body.triageLevel).toBe(3);
  });

  it.each(["DONE", "LEFT"])("returns 409 for a %s patient", async (status) => {
    const id = await arrive("08:00", "Ana", 3);
    // DONE needs treatment first; LEFT is straight from the waiting room.
    if (status === "DONE") await request(app).post("/queue/next").expect(200);
    await request(app).patch(`/patients/${id}/status`).send({ status }).expect(200);

    const res = await retriage(id, { triageLevel: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(`is ${status}`);
  });

  it("returns 404 for a patient that doesn't exist", async () => {
    const res = await retriage(42, { triageLevel: 2 });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: "Patient 42 not found" });
  });
});

describe("re-triage validation", () => {
  it.each([
    ["missing", {}],
    ["0", { triageLevel: 0 }],
    ["6", { triageLevel: 6 }],
    ["2.5", { triageLevel: 2.5 }],
    ['"2" (string)', { triageLevel: "2" }],
    ["null", { triageLevel: null }],
  ])("rejects triageLevel %s with 400", async (_label, body) => {
    const id = await arrive("08:00", "Ana", 3);

    const res = await retriage(id, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].field).toBe("triageLevel");
  });

  it("rejects a bad id with 400 before looking anything up", async () => {
    const res = await retriage("abc", { triageLevel: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: "id", message: "id must be a positive whole number" },
    ]);
  });

  it("rejects a body that isn't a JSON object", async () => {
    const id = await arrive("08:00", "Ana", 3);

    const res = await retriage(id, [2]);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      "Request body must be a JSON object, sent with Content-Type: application/json",
    );
  });
});
