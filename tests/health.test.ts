import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db/connection.js";

describe("GET /health", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  it("responds 200 when the database is reachable", async () => {
    const res = await request(createApp(db)).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "ok" });
  });

  it("responds 503 when the database is unavailable", async () => {
    const app = createApp(db);
    db.close();

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", database: "unavailable" });
  });
});
