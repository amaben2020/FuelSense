# Backend architecture

The backend is organised by **feature**, not by layer. Everything a feature
needs — its router, its business logic, its SQL — sits in one folder under
`src/features/<feature>/`, so a change to "idling" is a change inside
`features/telemetry/`, not a hunt across `routes/`, `services/` and `lib/`.

```
src/
├── config/                        # process-wide setup shared by every feature
│   ├── env.ts                     #   env validation, runs first
│   ├── db/index.ts                #   Drizzle client, pool, initDatabase()
│   ├── db/schema.ts               #   every table (the models — see below)
│   ├── db/queries.ts              #   raw SQL helpers over several tables
│   ├── redis.ts                   #   cache client + cacheKey/withCache
│   ├── metrics.ts                 #   Prometheus registry
│   ├── timezone.ts                #   pins the process to Africa/Lagos
│   └── openapi.ts                 #   Swagger spec served at /api/docs
├── shared/                        # cross-cutting helpers no single feature owns
│   ├── db-helpers.ts              #   re-exports db + tables + drizzle operators
│   ├── detector-state.ts          #   per-IMEI state, memory-first with a Redis copy
│   ├── errors.ts                  #   logAndRespond, ServiceError
│   ├── mailer.ts                  #   transactional email transport
│   ├── serialize.ts               #   number/date coercion for API rows
│   └── types.ts                   #   JwtPayload, FleetRole, request typings
├── features/
│   └── <feature>/
│       ├── <feature>.routes.ts    #   the Express router: paths + handlers
│       ├── <feature>.controller.ts#   (optional) handlers, when a router grows
│       ├── <name>.service.ts      #   business logic — pure where possible
│       ├── <name>.repository.ts   #   SQL builders / DB-only reads and writes
│       ├── <name>.middleware.ts   #   Express middleware the feature exports
│       └── <sub-folder>/          #   groups of adapters, fixtures, data files
├── scripts/                       # one-off CLIs run with tsx (seed, backfill…)
└── server.ts                      # creates the app and mounts every router
```

## The vocabulary

| Suffix | What goes in it | What must not |
|---|---|---|
| `*.routes.ts` | `express.Router()`, path definitions, request parsing, response shaping. Today most handlers live inline here. | SQL strings. Reach for a repository or service. |
| `*.controller.ts` | Request/response handlers split out of a routes file once it is too long to read. Optional. | Business rules — call a service. |
| `*.service.ts` | Domain logic: detectors, state machines, pricing, notifiers, sweeps. Pure functions first, side effects behind a clear entry point. | Express types. A service never sees `req`/`res`. |
| `*.repository.ts` | Drizzle `sql\`\`` builders and query functions. One concern per file (`telemetry-deltas`, `fleet-efficiency`, `daily-activity`). | Formatting for the UI, pricing decisions. |
| `*.middleware.ts` | `(req, res, next)` guards a feature exports (e.g. `auth.middleware.ts`). | — |

**Models.** Drizzle needs every table in one schema module for relations and
migrations, so the tables stay in `config/db/schema.ts`. A feature's "model"
is the slice of that schema it owns; `shared/db-helpers.ts` re-exports the
tables so feature code imports them from one place.

**Scripts.** Anything run by hand with `tsx` lives in `src/scripts/`. A script
is a thin caller of feature services — if a script grows logic, that logic
moves into the feature it belongs to.

## Where a change goes

| You are changing… | Folder |
|---|---|
| The FMC150 wire protocol, AVL element IDs, TCP ingest | `features/tracker/` |
| Trips, idling, harsh driving, telemetry aggregation SQL, event replay | `features/telemetry/` |
| Litres, fuel price, virtual tank, anomaly / siphon detection | `features/fuel/` |
| Receipt OCR, parsing, verification, reconciliation, the receipt sweep | `features/receipts/` |
| Alert types, retention, alert email | `features/alerts/` |
| Manager-side driver screens and reports | `features/drivers/` |
| The driver's own app (`/api/driver/*`) | `features/driver-portal/` |
| Demo fleets, mock devices, simulated tracks | `features/simulator/` |
| A new connection, cache, or process-wide setting | `config/` |
| A helper two or more features need and neither owns | `shared/` |

## Per-device state

A detector that needs to remember something about a device between frames
(idle since, last ignition, a stop in progress) keeps it in a
`DetectorState<T>` from `shared/detector-state.ts`, not a bare `Map`. It reads
and writes like a Map, but the state also lands in Redis so a deploy does not
forget an episode in progress — and it degrades to memory-only, with a short
timeout and a backoff, when Redis is unreachable. Give it a `revive` when the
state carries a `Date`.

## Rules

1. **A feature owns its folder.** New code for a feature goes in that folder,
   with the suffix that says what kind of code it is. Do not recreate
   `src/lib/` or `src/routes/`.
2. **Features may import from each other.** Import the specific file
   (`../fuel/fuel-price.service`), never a barrel that pulls a whole feature
   in. If two features keep importing each other, the shared piece probably
   belongs in `shared/` or is its own feature.
3. **`config/` and `shared/` never import from `features/`.** They are the
   bottom of the graph.
4. **Routes files do not carry SQL.** New queries go in a
   `*.repository.ts`; new rules go in a `*.service.ts`. Existing inline SQL
   in a routes file is moved when it is next touched, not in a sweep.
5. **Tests mirror the source.** A test for `features/telemetry/idle-detector.service.ts`
   imports it by that path; test files keep living in `tests/`.
6. **Adding a feature** means: create `src/features/<name>/`, add
   `<name>.routes.ts`, mount it in `server.ts`, and add a row to the table
   above.

## Why feature-based

The layer-based layout this replaced (`routes/`, `lib/`, `middleware/`) had
80 files in `lib/` with nothing but a filename to say which of them belonged
together. Fuel, receipts, and telemetry logic were interleaved, and a change
to idling touched `lib/idle-detector.ts`, `routes/telemetry.ts`, and
`tcp-server.ts` in three unrelated directories. Grouping by feature makes the
blast radius of a change visible from the folder listing.
