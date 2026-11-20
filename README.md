# Patient Triage Queue API

[![CI](https://github.com/nylla8444/Patient-Triage-Queue/actions/workflows/ci.yml/badge.svg)](https://github.com/nylla8444/Patient-Triage-Queue/actions/workflows/ci.yml)

A REST API for an emergency department's waiting list. Patients are seen **in order of medical urgency, not in order of arrival**. Among patients who are equally urgent, whoever has waited longest goes first.

The API keeps track of who is waiting and how urgent they are, and answers one question for the staff: **"Who do we see next?"**

**Stack:** Node.js 22 · TypeScript · Express 5 · SQLite (`better-sqlite3`) · Zod · Vitest + Supertest

## Contents

- [How the queue works](#how-the-queue-works)
- [Getting started](#getting-started)
- [API](#api)
- [Errors](#errors)
- [Design decisions](#design-decisions)
- [How I built it](#how-i-built-it)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Limitations and next steps](#limitations-and-next-steps)

## How the queue works

### Triage levels

A nurse assigns each patient a level from 1 to 5, based on the Emergency Severity Index (ESI) used in many hospitals. The API stores the level; it doesn't diagnose anyone or calculate the level itself.

| Level | Label | Meaning |
|---|---|---|
| 1 | Resuscitation | Immediate, life-saving care needed |
| 2 | Emergent | High risk, should not wait |
| 3 | Urgent | Stable but needs several resources |
| 4 | Less urgent | Needs one resource |
| 5 | Non-urgent | Needs no resources |

### The ordering rule

Waiting patients are sorted by:

1. **Triage level**, lowest first (level 1 is the most urgent).
2. **Arrival time**, earliest first: within the same level, whoever came first goes first.
3. **Id**, as a final tie-break, so two patients with the same timestamp always come out in the same order.

| Patient | Level | Arrived | Position |
|---|---|---|---|
| Ana | 3 | 08:00 | 2 |
| Ben | 4 | 08:01 | 4 |
| Carla | 2 | 08:05 | **1** |
| Dan | 3 | 08:07 | 3 |

Carla is first even though she arrived third, because she is level 2. Ana is ahead of Dan because both are level 3 and Ana arrived first.

If Ana gets worse and is re-triaged to level 2, she goes **ahead of Carla**: both are now level 2, and Ana has been waiting since 08:00. Re-triage keeps the original arrival time, so getting worse never sends a patient to the back of the line.

### Patient lifecycle

```
                 POST /queue/next                   PATCH /patients/:id/status
   WAITING  ─────────────────────►  IN_TREATMENT  ──────────────────────────►  DONE
      │
      │  PATCH /patients/:id/status
      └─────────────────────────────►  LEFT   (left without being seen)
```

- A patient can only reach `IN_TREATMENT` through `POST /queue/next`, so nobody can skip the queue.
- Only `WAITING` patients appear in the queue, and only they can be re-triaged.
- Any other change (e.g. marking a waiting patient `DONE`) is rejected with `409`.
- Patients are never deleted. `DONE` and `LEFT` records stay as history.

### Assumptions

The assignment gave the title only, so these are my own assumptions:

- One facility with one shared queue.
- Only staff use the API. Patients don't check themselves in.
- The server sets the arrival time. Clients can't send it, so nobody can move a patient up by back-dating them.
- Patients who are done or who left are kept as history, never deleted.

## Getting started

**Requirements:** Node.js 22 or newer (`node -v`) and npm.

```bash
git clone https://github.com/nylla8444/Patient-Triage-Queue.git
cd Patient-Triage-Queue
npm install
npm run dev
```

The server starts at `http://localhost:3000`. Check it with `GET http://localhost:3000/health`:

```json
{ "status": "ok", "database": "ok" }
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the server and restart it when a file changes |
| `npm test` | Run all tests once |
| `npm run test:watch` | Re-run tests when a file changes |
| `npm run typecheck` | Check types without building |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm start` | Run the compiled server from `dist/` (run `npm run build` first) |

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (1–65535; the server refuses to start with anything else) |
| `DB_PATH` | `data/triage.db` | SQLite file. Missing folders are created on startup. |

```bash
PORT=4000 DB_PATH=data/other.db npm run dev     # macOS / Linux
```

```powershell
$env:PORT = "4000"; $env:DB_PATH = "data/other.db"; npm run dev   # Windows PowerShell
```

### Data

The database and its table are created automatically on first start. Patients are saved in `data/`, so the queue survives a server restart. That folder is ignored by git.

`data/` holds three files: `triage.db`, `triage.db-wal` and `triage.db-shm`. SQLite runs in WAL mode, which writes recent changes to `triage.db-wal` first and copies them into `triage.db` later.

**To start over with an empty database:** stop the server, then delete the whole `data/` folder. Never delete only the `-wal` file: it can hold saved patients that aren't in `triage.db` yet.

## API

Every request and response body is JSON. Send bodies with the header `Content-Type: application/json`.

| Method | Path | Purpose | Success |
|---|---|---|---|
| `POST` | `/patients` | Register a patient; they join the queue | `201` + patient |
| `GET` | `/patients` | List all patients (any status), optional `?status=` filter | `200` |
| `GET` | `/patients/:id` | Get one patient (any status) | `200` |
| `GET` | `/queue` | Waiting patients in queue order | `200` |
| `PATCH` | `/patients/:id/triage` | Change a waiting patient's triage level | `200` + patient |
| `POST` | `/queue/next` | Call the next patient into treatment | `200` + patient, or `204` if nobody is waiting |
| `PATCH` | `/patients/:id/status` | Close a visit: `DONE` or `LEFT` | `200` + patient |
| `GET` | `/health` | Is the server up and can it reach the database? | `200` (or `503`) |

The examples below follow the worked example above, in the order staff would use the API.

### The patient object

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Set by the server |
| `fullName` | string | |
| `age` | integer or `null` | Optional |
| `complaint` | string | Chief complaint, e.g. `"chest pain"` |
| `triageLevel` | integer 1–5 | |
| `status` | `WAITING` · `IN_TREATMENT` · `DONE` · `LEFT` | Set by the server |
| `arrivedAt` | ISO 8601 UTC timestamp | Set by the server at registration |
| `calledAt` | timestamp or `null` | When the patient was called in (`POST /queue/next`) |
| `finishedAt` | timestamp or `null` | When the visit was closed (`DONE` or `LEFT`) |

### Register a patient: `POST /patients`

```http
POST /patients
Content-Type: application/json

{ "fullName": "Ana Cruz", "age": 34, "complaint": "abdominal pain", "triageLevel": 3 }
```

`201 Created`, with a `Location: /patients/1` header:

```json
{
  "id": 1,
  "fullName": "Ana Cruz",
  "age": 34,
  "complaint": "abdominal pain",
  "triageLevel": 3,
  "status": "WAITING",
  "arrivedAt": "2026-11-20T08:00:00.000Z",
  "calledAt": null,
  "finishedAt": null
}
```

| Field | Rule |
|---|---|
| `fullName` | required text, 1–100 characters after trimming spaces |
| `age` | optional whole number, 0–130 (may be left out or `null`) |
| `complaint` | required text, 1–500 characters after trimming spaces |
| `triageLevel` | required whole number, 1–5 |

Input is strict on purpose: numbers must be real JSON numbers (`"3"` in quotes is rejected, not guessed at). Fields the server owns (`id`, `status`, `arrivedAt`, …) are ignored if a client sends them.

More bodies to try:

```json
{ "fullName": "Ben Santos", "age": 52, "complaint": "sprained ankle", "triageLevel": 4 }
{ "fullName": "Carla Reyes", "age": 67, "complaint": "chest pain", "triageLevel": 2 }
{ "fullName": "Dan Lim", "complaint": "high fever", "triageLevel": 3 }
```

### View the queue: `GET /queue`

Returns only `WAITING` patients, in queue order. Each entry is the full patient plus two values calculated at the moment of the request (never stored, so they can't go stale):

- `position`: 1 is the next patient to be called.
- `waitingMinutes`: whole minutes since arrival.

Response at 08:17, with the four patients above:

```jsonc
{
  "count": 4,
  "data": [
    {
      "position": 1,
      "id": 3,
      "fullName": "Carla Reyes",
      "age": 67,
      "complaint": "chest pain",
      "triageLevel": 2,
      "status": "WAITING",
      "arrivedAt": "2026-11-20T08:05:00.000Z",
      "calledAt": null,
      "finishedAt": null,
      "waitingMinutes": 12
    }
    // position 2: Ana (level 3, 08:00), position 3: Dan (level 3, 08:07), position 4: Ben (level 4, 08:01)
  ]
}
```

An empty queue returns `{ "count": 0, "data": [] }`.

### Re-triage: `PATCH /patients/:id/triage`

For a patient whose condition changed while waiting. Only `WAITING` patients can be re-triaged; their arrival time is kept.

```http
PATCH /patients/1/triage
Content-Type: application/json

{ "triageLevel": 2 }
```

`200 OK` with the updated patient. Ana is now at position 1 in `GET /queue`, ahead of Carla.

Re-triaging a patient who is no longer waiting returns `409`:

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Patient 1 is DONE; only WAITING patients can be re-triaged" } }
```

### Call the next patient: `POST /queue/next`

No body. Takes the patient at position 1, moves them to `IN_TREATMENT`, sets `calledAt`, and returns them:

```json
{
  "id": 1,
  "fullName": "Ana Cruz",
  "age": 34,
  "complaint": "abdominal pain",
  "triageLevel": 2,
  "status": "IN_TREATMENT",
  "arrivedAt": "2026-11-20T08:00:00.000Z",
  "calledAt": "2026-11-20T08:20:00.000Z",
  "finishedAt": null
}
```

If nobody is waiting, it returns **`204 No Content`** with an empty body. That isn't an error: the request worked, there was just nobody to call.

If two doctors press "next" at the same moment, each gets a **different** patient (see [Design decisions](#design-decisions)).

### Close a visit: `PATCH /patients/:id/status`

| Body | Allowed from | Meaning |
|---|---|---|
| `{ "status": "DONE" }` | `IN_TREATMENT` | Treatment finished |
| `{ "status": "LEFT" }` | `WAITING` | Patient left without being seen |

```http
PATCH /patients/1/status
Content-Type: application/json

{ "status": "DONE" }
```

`200 OK` with the patient, now `DONE` with `finishedAt` set. If Ben gets tired of waiting and goes home, `PATCH /patients/2/status` with `{ "status": "LEFT" }` takes him out of the queue.

Any other change returns `409`, for example marking a patient `DONE` who was never called:

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Patient 3 is WAITING; only IN_TREATMENT patients can be marked DONE" } }
```

`WAITING` and `IN_TREATMENT` can't be set here: a finished visit never reopens, and `IN_TREATMENT` only comes from `POST /queue/next`.

### List patients: `GET /patients` and `GET /patients/:id`

`GET /patients` returns everyone, in registration order, including finished visits:

```jsonc
{
  "count": 4,
  "data": [
    // full patient objects, id 1 first: Ana (DONE), Ben (LEFT), Carla (WAITING), Dan (WAITING)
  ]
}
```

Add `?status=` to filter, e.g. `GET /patients?status=IN_TREATMENT` for who is being treated right now. Valid values are `WAITING`, `IN_TREATMENT`, `DONE` and `LEFT`, uppercase.

`GET /patients?status=WAITING` shows the same people as `GET /queue` but in registration order. For "who's next", always use `/queue`.

`GET /patients/:id` returns one patient in any status, or `404` if the id doesn't exist. The id must be a positive whole number (`/patients/abc` returns `400`).

### Health: `GET /health`

Runs a tiny query against the database, so it reports whether the API can actually work, not just whether the process is running.

| Status | Body |
|---|---|
| `200` | `{ "status": "ok", "database": "ok" }` |
| `503` | `{ "status": "error", "database": "unavailable" }` |

## Errors

Every error, from every endpoint, has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "fullName cannot be empty",
    "details": [
      { "field": "fullName", "message": "fullName cannot be empty" },
      { "field": "triageLevel", "message": "triageLevel is required and must be a number from 1 to 5" }
    ]
  }
}
```

`details` appears only on validation errors, and lists every problem at once, not just the first.

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body, broken JSON, bad `:id`, bad `?status=` |
| 400 | `BAD_REQUEST` | Other malformed requests, e.g. broken URL encoding |
| 404 | `NOT_FOUND` | Unknown patient id or unknown route |
| 405 | `METHOD_NOT_ALLOWED` | The path exists but not with this method, e.g. `DELETE /patients/1`. The `Allow` header lists the valid methods. |
| 409 | `INVALID_TRANSITION` | Valid request, but not allowed for this patient's current status |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 KB (the largest valid body is under 1 KB) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body not sent as UTF-8 |
| 500 | `INTERNAL_ERROR` | Anything unexpected. Details are logged on the server, never sent to the client. |

A common mistake: if the body is JSON but sent as plain text (e.g. "Text" instead of "JSON" in Postman), the error message says to send it with `Content-Type: application/json`.

## Design decisions

I wrote each choice down with the options I considered and the trade-off. These are the main ones.

| Decision | Why | Trade-off |
|---|---|---|
| **SQLite from the start**, not an in-memory list | If the server restarts, an in-memory queue loses every waiting patient. In an ER that means people silently disappear from the list. SQLite is one file, with no database server to install. | A schema exists from day one. It's created with `CREATE TABLE IF NOT EXISTS` at startup instead of a migration tool. |
| **`better-sqlite3`** (synchronous driver) | SQLite runs inside the same process on a local file, so a query takes microseconds and the code reads top to bottom. An ORM would hide the SQL, which is the core of this project. | A very slow query would block other requests. Fine for one facility's queue. |
| **Queue order in SQL**, with a matching index | The rule is written once (`ORDER BY triage_level, arrived_at, id`) and shared by "view queue" and "call next", so they can never disagree. A test checks SQLite's query plan to prove the index is actually used. | |
| **"Call next" is one atomic `UPDATE … RETURNING`** | Picking the patient and claiming them happen in one statement, so two doctors pressing "next" at once can't get the same patient. | Needs SQLite 3.35+, which `better-sqlite3` includes. |
| **Status checks inside the `UPDATE`** (re-triage, close visit) | `UPDATE … WHERE id = ? AND status = 'WAITING'` can't change a patient who was called a moment earlier. Reading first and updating second leaves a gap for exactly that. If nothing changed, a second read only decides between `404` and `409`. | |
| **Re-triage keeps the arrival time** | A patient who gets worse shouldn't lose their place among equally urgent patients. | |
| **No automatic priority aging** | Moving level-5 patients up over time is a clinical policy, not something to assume. `waitingMinutes` makes long waits visible so staff can re-triage. | A low-urgency patient can wait a long time if urgent cases keep arriving. |
| **The server owns `id`, `status` and `arrivedAt`** | Clients can't back-date a patient or set them straight to `IN_TREATMENT`. | |
| **Records are never deleted** | Finished and left patients stay as history (e.g. how many left without being seen). There is no `DELETE` route; trying one returns `405`. | |
| **Empty queue on "call next" returns `204`** | Nobody waiting is a normal situation, not an error, so `404` would be wrong. | |
| **Routes → service → repository**, and `createApp(db, { now })` | Each layer has one job: HTTP, rules, SQL. Tests pass in an in-memory database and a fixed clock, so they're fast and repeatable. | A few more files than one big `app.ts`. |
| **No authentication in v1** | Out of scope for this assignment, and written down as a known risk. | Anyone who can reach the server can change the queue. This is the first thing to add before real use. |

## How I built it

1. **Understand the problem before the code.** I read how real ER triage works (ESI levels) and wrote the ordering rule down exactly, with a worked example, before writing any endpoint. Every endpoint depends on that rule.
2. **Turn user needs into endpoints.** Short user stories for nurses and doctors (register, re-triage, call next, see the queue, close a visit), then one endpoint per need.
3. **List edge cases early:** ties, two doctors calling at once, a patient walking out, a condition getting worse, an empty queue, a server restart.
4. **Build in small vertical slices.** Each step is one pull request with its code and tests, and CI must pass before merging.
5. **Check that the tests can fail.** After each step I broke the rule on purpose (e.g. removed the `WAITING` filter from "call next") to confirm the tests catch it, then restored it.
6. **Test the running server, not just the tests.** In step 7, I sent the real server requests nobody sends on purpose. Every error already had the right shape, but 5 responses were misleading (e.g. `DELETE /patients/1` said "route not found" instead of "method not allowed"). All 5 were fixed and are now covered by tests.

| Step | Pull request | What it added |
|---|---|---|
| 0 | [#1](https://github.com/nylla8444/Patient-Triage-Queue/pull/1) | Project setup: Express + TypeScript, `/health`, test runner |
| 0.5 | [#2](https://github.com/nylla8444/Patient-Triage-Queue/pull/2) | CI: typecheck, tests and build on every pull request |
| 1 | [#3](https://github.com/nylla8444/Patient-Triage-Queue/pull/3) | SQLite connection, `patients` table and queue index |
| 2 | [#4](https://github.com/nylla8444/Patient-Triage-Queue/pull/4) | Register and get a patient, plus the standard error format |
| 3 | [#5](https://github.com/nylla8444/Patient-Triage-Queue/pull/5) | View the queue in priority order |
| 4 | [#6](https://github.com/nylla8444/Patient-Triage-Queue/pull/6) | Call next atomically; `GET /patients` (added after manual testing showed it was needed) |
| 5 | [#7](https://github.com/nylla8444/Patient-Triage-Queue/pull/7) | Re-triage waiting patients |
| 6 | [#8](https://github.com/nylla8444/Patient-Triage-Queue/pull/8) | Close a visit: `DONE` or `LEFT` |
| 7 | [#9](https://github.com/nylla8444/Patient-Triage-Queue/pull/9) | Error audit of the running server: 5 fixes and an error contract test |
| 8 | this README | Setup and API usage |

## Testing

```bash
npm test
```

152 tests run against a fresh in-memory SQLite database each time, so no test touches a real file or depends on another test. A fixed clock makes arrival times and `waitingMinutes` predictable.

| File | Tests | What it covers |
|---|---|---|
| `patients.test.ts` | 37 | Registering and getting patients, every validation rule, ignored server-owned fields |
| `error-format.test.ts` | 31 | 22 bad requests across all endpoints return the standard error shape, with nothing internal leaked; `405`, `413`, `415` details |
| `close-visit.test.ts` | 19 | Every allowed and rejected status change |
| `retriage.test.ts` | 19 | Re-triage moves the patient correctly and keeps their arrival time; `409` for non-waiting patients |
| `db.test.ts` | 15 | Table and index, `CHECK` constraints, missing folders created, patients kept after a restart |
| `list-patients.test.ts` | 11 | `GET /patients` and the `?status=` filter |
| `queue.test.ts` | 10 | The ordering rule (worked example, exact ties), waiting time, and SQLite's query plan proving the index is used |
| `call-next.test.ts` | 8 | Calling in queue order, `204` when empty, two doctors at once |
| `health.test.ts` | 2 | `200` when the database works, `503` when it doesn't |

The "two doctors at once" case is tested twice: 5 requests sent at the same time through the API, and two separate database connections to the same file (like two copies of the server). Both get different patients every time.

An honest limit: the database driver is synchronous, so inside one Node process requests already run one at a time, and these tests can't create a true race. What actually protects against two server processes is that "call next" is a single `UPDATE` statement, which SQLite runs as one unit with one writer at a time. I checked the tests do catch a broken query: removing the `WAITING` filter from it makes 8 tests fail, including both "two doctors" tests.

## Project structure

```
src/
  server.ts                 reads config, opens the database, starts listening
  app.ts                    createApp(db): builds the Express app (no listening, easy to test)
  config.ts                 PORT and DB_PATH from environment variables
  errors.ts                 AppError and the error codes
  db/
    connection.ts           opens SQLite, enables WAL, creates the schema
    schema.ts               the table and index, as SQL
  middleware/
    errorHandler.ts         turns every error into the standard format; 404 and 405
  triage/
    triage.types.ts         Patient, TriageLevel, statuses
    triage.validation.ts    Zod rules for bodies, ids and query strings
    triage.repository.ts    all SQL; maps database rows to camelCase
    triage.service.ts       business rules: transitions, positions, waiting time
    triage.routes.ts        HTTP only: read the request, call the service, respond
tests/                      one file per feature, see Testing
.github/workflows/ci.yml    typecheck, test and build on every pull request
```

## Limitations and next steps

**Known limits of v1**

- No login or roles. Anyone who can reach the server can change the queue.
- One queue for the whole facility.
- No pagination on `GET /patients`. Fine for one facility's daily volume, not for years of history.
- No "pick a specific patient" endpoint: everyone goes through `POST /queue/next`.

**Next**

- A simple frontend: a queue board that refreshes itself, plus a registration form, using these same endpoints.
- Roles: nurses register and re-triage, doctors call next and close visits.
- An audit log of every triage change (who, from what, to what, when).
- Wait-time targets per level, with a warning when one is exceeded.

**Questions I'd ask a real stakeholder**

- Is there one queue, or one per department or doctor?
- Can a doctor pick a patient out of order (e.g. a specialist case)? If so, who is allowed to, and is it logged?
- How long should finished visits be kept, and who can see them?
- When two patients have the same level, is arrival time always the right tie-breaker?
