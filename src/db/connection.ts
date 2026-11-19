import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { schema } from "./schema.js";

export type Db = Database.Database;

/**
 * Opens (or creates) the SQLite database and makes sure the schema exists.
 * Pass ":memory:" for a throwaway database, which is what the tests use.
 */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // WAL mode: reads don't wait for writes, and the file stays safe if the process crashes.
  db.pragma("journal_mode = WAL");

  db.exec(schema);

  return db;
}
