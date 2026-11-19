import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";
import { createPatientRepository } from "../src/triage/triage.repository.js";

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

async function arrive(time: string, fullName: string, triageLevel: number) {
  clock = at(time);
  const res = await request(app)
    .post("/patients")
    .send({ fullName, complaint: "test complaint", triageLevel });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function callNext(time: string) {
  clock = at(time);
  return request(app).post("/queue/next");
}

/** The PLAN §5 worked example. Queue order: Carla, Ana, Dan, Ben. */
async function arriveWorkedExample() {
  await arrive("08:00", "Ana", 3);
  await arrive("08:01", "Ben", 4);
  await arrive("08:05", "Carla", 2);
  await arrive("08:07", "Dan", 3);
}

describe("POST /queue/next", () => {
  it("returns 204 with no body when nobody is waiting", async () => {
    const res = await callNext("08:00");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("calls the patient at position 1 and moves them to IN_TREATMENT", async () => {
    await arriveWorkedExample();

    const res = await callNext("08:10");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fullName: "Carla",
      triageLevel: 2,
      status: "IN_TREATMENT",
      arrivedAt: "2026-11-20T08:05:00.000Z", // unchanged
      calledAt: "2026-11-20T08:10:00.000Z", // the server's time when called
      finishedAt: null,
    });
  });

  it("removes the called patient from the queue", async () => {
    await arriveWorkedExample();
    await callNext("08:10");

    const queue = await request(app).get("/queue");

    expect(queue.body.data.map((p: { fullName: string }) => p.fullName)).toEqual([
      "Ana",
      "Dan",
      "Ben",
    ]);
    expect(queue.body.data[0].position).toBe(1);
  });

  it("calls everyone in queue order, then returns 204", async () => {
    await arriveWorkedExample();

    const called: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await callNext("08:10");
      expect(res.status).toBe(200);
      called.push(res.body.fullName);
    }

    expect(called).toEqual(["Carla", "Ana", "Dan", "Ben"]);
    expect((await callNext("08:11")).status).toBe(204);
  });

  it("always calls whoever GET /queue shows at position 1", async () => {
    await arriveWorkedExample();
    await arrive("08:09", "Eve", 1); // most urgent, arrived last

    for (let i = 0; i < 5; i++) {
      const queue = await request(app).get("/queue");
      const next = await callNext("08:10");
      expect(next.body.id).toBe(queue.body.data[0].id);
    }
  });

  it("saves the change: GET /patients/:id shows the patient in treatment", async () => {
    await arrive("08:00", "Ana", 3);
    const called = await callNext("08:15");

    const res = await request(app).get(`/patients/${called.body.id}`);

    expect(res.body.status).toBe("IN_TREATMENT");
    expect(res.body.calledAt).toBe("2026-11-20T08:15:00.000Z");
  });
});

describe("two doctors pressing 'next' at the same moment", () => {
  it("never gives the same patient twice when requests arrive together", async () => {
    await arrive("08:00", "Ana", 3);
    await arrive("08:01", "Ben", 3);
    await arrive("08:02", "Carla", 3);

    // 5 doctors, 3 patients, all requests sent at once.
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post("/queue/next")));

    const calledIds = results.filter((r) => r.status === 200).map((r) => r.body.id);
    expect(calledIds).toHaveLength(3);
    expect(new Set(calledIds).size).toBe(3); // no duplicates
    expect(results.filter((r) => r.status === 204)).toHaveLength(2);
  });

  describe("across two separate database connections (like two server processes)", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "triage-call-next-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("each connection claims a different patient", () => {
      const path = join(dir, "triage.db");
      const serverA = openDatabase(path);
      const serverB = openDatabase(path);
      const repoA = createPatientRepository(serverA);
      const repoB = createPatientRepository(serverB);

      for (const fullName of ["Ana", "Ben"]) {
        repoA.insert({ fullName, age: null, complaint: "x", triageLevel: 3, arrivedAt: at("08:00").toISOString() });
      }

      const first = repoA.claimNextWaiting(at("08:10").toISOString());
      const second = repoB.claimNextWaiting(at("08:10").toISOString());
      const third = repoA.claimNextWaiting(at("08:10").toISOString());

      serverA.close();
      serverB.close();

      expect(first?.fullName).toBe("Ana");
      expect(second?.fullName).toBe("Ben");
      expect(third).toBeUndefined();
    });
  });
});
