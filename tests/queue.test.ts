import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";
import { WAITING_QUEUE_SQL } from "../src/triage/triage.repository.js";
import { minutesBetween } from "../src/triage/triage.service.js";

/** "08:05" -> 2026-11-20T08:05:00.000Z (seconds optional: "08:04:59"). */
function at(time: string): Date {
  const [h, m, s = "00"] = time.split(":");
  return new Date(`2026-11-20T${h}:${m}:${s}.000Z`);
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

/** Registers a patient as if they walked in at the given time. */
async function arrive(time: string, fullName: string, triageLevel: number) {
  clock = at(time);
  const res = await request(app)
    .post("/patients")
    .send({ fullName, complaint: "test complaint", triageLevel });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function getQueue(time: string) {
  clock = at(time);
  const res = await request(app).get("/queue");
  expect(res.status).toBe(200);
  return res.body as {
    count: number;
    data: { position: number; id: number; fullName: string; waitingMinutes: number }[];
  };
}

const names = (queue: { data: { fullName: string }[] }) => queue.data.map((p) => p.fullName);

describe("GET /queue", () => {
  it("returns an empty queue when nobody is waiting", async () => {
    expect(await getQueue("08:00")).toEqual({ count: 0, data: [] });
  });

  it("orders the PLAN §5 worked example: urgency first, then arrival time", async () => {
    await arrive("08:00", "Ana", 3);
    await arrive("08:01", "Ben", 4);
    await arrive("08:05", "Carla", 2);
    await arrive("08:07", "Dan", 3);

    const queue = await getQueue("08:10");

    expect(queue.count).toBe(4);
    // Carla is first despite arriving third (level 2). Ana before Dan (both 3, Ana earlier). Ben last.
    expect(names(queue)).toEqual(["Carla", "Ana", "Dan", "Ben"]);
    expect(queue.data.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    expect(queue.data.map((p) => p.waitingMinutes)).toEqual([5, 10, 3, 9]);
  });

  it("returns the full patient plus position and waitingMinutes", async () => {
    await arrive("08:00", "Ana", 3);

    const queue = await getQueue("08:30");

    expect(queue.data[0]).toEqual({
      position: 1,
      id: 1,
      fullName: "Ana",
      age: null,
      complaint: "test complaint",
      triageLevel: 3,
      status: "WAITING",
      arrivedAt: "2026-11-20T08:00:00.000Z",
      calledAt: null,
      finishedAt: null,
      waitingMinutes: 30,
    });
  });

  it("puts a level 1 patient first even if they arrived last", async () => {
    await arrive("08:00", "Ana", 2);
    await arrive("08:01", "Ben", 2);
    await arrive("08:20", "Eve", 1);

    expect(names(await getQueue("08:21"))).toEqual(["Eve", "Ana", "Ben"]);
  });

  it("uses id as the final tie-break when level and arrival time are identical", async () => {
    await arrive("08:00", "First", 3);
    await arrive("08:00", "Second", 3);
    await arrive("08:00", "Third", 3);

    expect(names(await getQueue("08:00"))).toEqual(["First", "Second", "Third"]);
  });

  it("shows only WAITING patients", async () => {
    await arrive("08:00", "Ana", 3);
    const ben = await arrive("08:01", "Ben", 3);
    const carla = await arrive("08:02", "Carla", 3);
    const dan = await arrive("08:03", "Dan", 3);

    // Endpoints for these come in steps 4 and 6, so set the status directly for now.
    const setStatus = db.prepare("UPDATE patients SET status = ? WHERE id = ?");
    setStatus.run("IN_TREATMENT", ben.id);
    setStatus.run("DONE", carla.id);
    setStatus.run("LEFT", dan.id);

    const queue = await getQueue("08:10");

    expect(names(queue)).toEqual(["Ana"]);
    expect(queue.count).toBe(1);
  });

  it("recalculates waiting time on every request", async () => {
    await arrive("08:00", "Ana", 3);

    expect((await getQueue("08:00")).data[0]?.waitingMinutes).toBe(0);
    expect((await getQueue("09:15")).data[0]?.waitingMinutes).toBe(75);
  });
});

describe("minutesBetween", () => {
  it("rounds down to whole minutes", () => {
    expect(minutesBetween(at("08:00"), at("08:04:59"))).toBe(4);
    expect(minutesBetween(at("08:00"), at("08:05"))).toBe(5);
  });

  it("never returns a negative wait (e.g. the server clock moved back)", () => {
    expect(minutesBetween(at("08:10"), at("08:00"))).toBe(0);
  });
});

describe("queue query", () => {
  it("reads rows in order straight from idx_queue_order, with no extra sort step (D3)", () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${WAITING_QUEUE_SQL}`).all() as { detail: string }[];
    const details = plan.map((step) => step.detail).join(" | ");

    expect(details).toContain("USING INDEX idx_queue_order");
    expect(details).not.toContain("TEMP B-TREE");
  });
});
