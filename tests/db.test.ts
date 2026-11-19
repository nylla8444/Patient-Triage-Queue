import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../src/db/connection.js";

type PatientRow = Record<string, string | number | null>;

/** Inserts a valid patient; pass fields to override (or break) any column. */
function insertPatient(db: Db, fields: PatientRow = {}) {
  const row: PatientRow = {
    full_name: "Ana Cruz",
    complaint: "abdominal pain",
    triage_level: 3,
    arrived_at: "2026-11-19T08:00:00.000Z",
    ...fields,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((column) => `@${column}`);

  return db
    .prepare(`INSERT INTO patients (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`)
    .run(row);
}

describe("schema", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the patients table with the planned columns", () => {
    const columns = db.pragma("table_info(patients)") as { name: string }[];

    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "full_name",
      "age",
      "complaint",
      "triage_level",
      "status",
      "arrived_at",
      "called_at",
      "finished_at",
    ]);
  });

  it("creates the queue index in the same column order as the queue sort", () => {
    const columns = db.pragma("index_info(idx_queue_order)") as { name: string }[];

    expect(columns.map((c) => c.name)).toEqual(["status", "triage_level", "arrived_at", "id"]);
  });

  it("puts new patients in WAITING status by default", () => {
    const { lastInsertRowid } = insertPatient(db);
    const row = db.prepare("SELECT status FROM patients WHERE id = ?").get(lastInsertRowid);

    expect(row).toEqual({ status: "WAITING" });
  });

  it.each([0, 6, -1])("rejects triage level %s", (level) => {
    expect(() => insertPatient(db, { triage_level: level })).toThrow(/CHECK constraint failed/);
  });

  it.each([1, 5])("accepts triage level %s", (level) => {
    expect(() => insertPatient(db, { triage_level: level })).not.toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => insertPatient(db, { status: "SKIPPED" })).toThrow(/CHECK constraint failed/);
  });

  it.each(["full_name", "complaint", "triage_level", "arrived_at"])(
    "rejects a patient without %s",
    (column) => {
      expect(() => insertPatient(db, { [column]: null })).toThrow(/NOT NULL constraint failed/);
    },
  );
});

describe("database file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "triage-db-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates missing folders for the database path", () => {
    const db = openDatabase(join(dir, "nested", "folder", "triage.db"));

    expect(db.open).toBe(true);
    db.close();
  });

  it("keeps patients after the database is closed and reopened (server restart)", () => {
    const path = join(dir, "triage.db");

    const first = openDatabase(path);
    insertPatient(first);
    first.close();

    // Reopening runs the schema again; it must not wipe or fail on existing data.
    const second = openDatabase(path);
    const { count } = second.prepare("SELECT COUNT(*) AS count FROM patients").get() as {
      count: number;
    };
    second.close();

    expect(count).toBe(1);
  });
});
