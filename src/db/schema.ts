// Applied every time the database is opened. "IF NOT EXISTS" makes it safe to run
// again on an existing database, so no separate migration step is needed for v1.
//
// The CHECK constraints repeat the API's validation rules on purpose: if a bug ever
// slips past validation, the database still refuses invalid data.
export const schema = `
CREATE TABLE IF NOT EXISTS patients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  age           INTEGER,
  complaint     TEXT    NOT NULL,
  triage_level  INTEGER NOT NULL CHECK (triage_level BETWEEN 1 AND 5),
  status        TEXT    NOT NULL DEFAULT 'WAITING'
                CHECK (status IN ('WAITING', 'IN_TREATMENT', 'DONE', 'LEFT')),
  arrived_at    TEXT    NOT NULL,
  called_at     TEXT,
  finished_at   TEXT
);

-- Same column order as the queue's ORDER BY, so reading the queue uses this index.
CREATE INDEX IF NOT EXISTS idx_queue_order
  ON patients (status, triage_level, arrived_at, id);
`;
