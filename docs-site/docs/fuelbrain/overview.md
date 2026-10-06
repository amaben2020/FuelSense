---
id: overview
title: FuelBrain assistant
sidebar_position: 1
---

# FuelBrain assistant

FuelBrain is the chat assistant in the dashboard. A manager asks a question in
plain English ("who's my best driver?", "when does my VIO expire?") and Claude
answers it by calling read-only **tools** over the fleet's own data. It can
also **draft** an email to a driver, which only goes out when the manager
presses Send.

:::info Agent, not retrieval
FuelBrain does not search documents. "Who is my best driver" is a calculation
over trips, harsh events and receipts, so each tool calls the same API endpoint
the dashboard reads, **with the asker's own login token**. Every figure it
quotes is one the manager can find on a screen, scoped to their fleet by the
same auth middleware.
:::

## How a question is answered

```mermaid
sequenceDiagram
    participant UI as Chat (FuelBrain.tsx)
    participant API as POST /api/fuelbrain/chat
    participant C as Claude (tool runner)
    participant T as Tools
    UI->>API: question + sessionId
    API->>API: allowance check (credits)
    API->>C: system prompt, history, tools
    loop until Claude has what it needs
        C->>T: tool call (e.g. vehicle_status)
        T-->>C: JSON from the fleet's own endpoints
        API-->>UI: SSE "tool" (shown as "Checking…")
    end
    C-->>API: answer, streamed
    API-->>UI: SSE "text" deltas, "action" cards
    API->>API: save turn, charge tokens
    API-->>UI: SSE "done" (session, allowance, model, usage)
```

- **Code:** `backend/src/features/fuelbrain/` (`fuelbrain.service.ts` for the
  prompt and tools, `fuelbrain.routes.ts` for the endpoints,
  `fuelbrain-usage.service.ts` for the allowance) and
  `frontend/src/components/dashboard/FuelBrain*.tsx`.
- **Model:** `claude-opus-5-5`, adaptive thinking, effort `medium`, with the
  server-side refusal fallback (`fallbacks: "default"`).
- **Streaming:** the endpoint answers with server-sent events: `tool`, `text`,
  `action`, `done` and `error`. Stopping in the UI aborts the model call.

## Tools

| Tool | Reads | Used for |
|---|---|---|
| `vehicle_status` | database (fleet-scoped) | rate and its source, tank, driver, and the tracker state: **parked** (ignition off + AVL 69 = 3), driving, offline, no GPS fix |
| `driver_performance` | `/drivers/reports` | ranking and comparing drivers |
| `fleet_summary` | `/dashboard/summary` | fleet headline figures |
| `vehicle_efficiency` | `/telemetry/fleet-efficiency`, reshaped | per-vehicle litres, `rated_l_per_100km` vs `period_effective_l_per_100km_incl_idle_and_corrections` |
| `list_vehicles` | `/vehicles/fleet` | the fleet |
| `recent_alerts` | `/alerts` | alerts |
| `fuel_receipts` | `/telemetry/fuel-purchases` | receipts, the only real fuel evidence |
| `fuel_station_visits` | `/fuel-stations/visits` | stops at marked stations |
| `harsh_driving` | `/device-events?type=driving` | each harsh event with time, speed and g |
| `maintenance_status` | `/maintenance` | service schedule |
| `certificates` | `/certificates` | vehicle licence / VIO expiry (`kind: vio` **is** the VIO certificate) |
| `draft_driver_message` | writes a **pending** draft | messages to drivers (see below) |

Two tool outputs are deliberately reshaped or relabelled because FuelBrain once
misread them in production: the period litres-per-km figure was quoted as the
car's rated consumption, and a parked car was called a GPS fault.

## Product rules in the prompt

The system prompt carries rules FuelBrain must not argue against:

- No sensor measures the tank; litres are **modelled** (km × rated L/100 km,
  speed-adjusted, plus idle hours × idle L/h). Receipts are the only real
  evidence.
- Receipts are recorded, never judged: no fill-to-full, gauge photos or
  station checks.
- Ignition off with the GPS asleep is a parked car, not a fault.
- Never send the manager to "FuelSense support" or an installer for something
  a tool can answer.

## Charts and diagrams

The chat renders two kinds of fenced block:

- ` ```chart ` holds JSON:
  `{"type":"bar"|"line","title":"…","unit":"km","x":[…],"series":[{"name":"…","values":[…]}]}`,
  with 1–6 series, at most 31 labels and numbers only. It is validated by
  `frontend/src/lib/fuelbrain-chart-spec.ts`; an invalid spec is shown as
  source with the reason, never drawn wrong. Charts are hand-built SVG with a
  hover tooltip and a **Show data** table. The series palette was validated
  for colour-blind separation in both themes.
- ` ```mermaid ` holds a flowchart or sequence diagram, rendered with
  `securityLevel: 'strict'`. Mermaid loads on first use.

While an answer is still streaming, both show a placeholder.

## Messaging drivers

```mermaid
flowchart LR
    A[Manager: 'warn Benneth about braking'] --> B[FuelBrain checks the data]
    B --> C[draft_driver_message]
    C --> D[(fuelbrain_actions<br/>status = pending)]
    D --> E[Card in chat:<br/>Edit / Discard / Send]
    E -->|Send| F[POST /fuelbrain/actions/:id/send]
    F --> G[SendGrid to the driver<br/>reply-to = manager]
```

FuelBrain can only **draft**. Nothing is emailed until the manager presses
Send on the card, and the server enforces that:

- **Approval:** the status flips from `pending` to `sent` atomically, so a
  double click or a replayed request cannot send twice.
- **Ownership:** only the person who asked can send or discard a draft.
- **Verified accounts only:** an unverified sign-up cannot mail third parties.
- **Daily cap:** 20 driver emails per fleet per day.
- **Expiry:** drafts older than 24 hours must be redrafted.
- **Reply-to:** set to whoever pressed Send, so the driver's reply reaches the manager.

A driver with no email on file gets no draft. FuelBrain says so and points to
Driver management. The prompt also forbids drafting accusations of theft or
fraud.

## Allowance (credits)

Each fleet gets **1,000 credits per Lagos calendar month**, where 1 credit is
1,000 API tokens (input, cache and output). A typical question costs 5–15
credits. Every model call counts, including failed and stopped answers. A call
stopped before Claude reports usage is charged 3 credits, roughly the prompt
plus tool definitions. Once the allowance is used, the endpoint answers `429`
with the reset date. Set `FUELBRAIN_MONTHLY_CREDITS` to change the cap.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | required; without it the chat shows "not switched on" |
| `FUELBRAIN_MONTHLY_CREDITS` | monthly allowance per fleet (default 1000) |

Tables, created at boot: `fuelbrain_sessions`, `fuelbrain_messages`,
`fuelbrain_usage`, `fuelbrain_actions`.

## Tests and evals

**Unit tests** run in CI before every backend deploy:

- `tests/fuelbrain.test.ts`: the parked/driving/offline rule, driver
  matching, the reshaped efficiency fields, the Lagos-month allowance and the
  chart validator.
- `tests/fuelbrain-eval-grader.test.ts`: checks the eval's grader against
  known-good and empty answers, and checks the fixture's database guard.

**The eval** (`backend/evals/fuelbrain/`) asks the real model 15 questions
through the real endpoint, against a fixed fixture fleet, and grades each
answer programmatically. The checks cover facts that must appear, claims that
must not, which tools ran, and whether a draft was or wasn't created. Five
cases are real production mistakes. It costs real money, so run it on purpose,
for example after changing the prompt or tools, or before switching models:

```bash
# 1. a throwaway database (never the production tunnel on :15432)
docker run -d --rm --name fs-test-pg -p 15499:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=fuelsense_test postgres:16-alpine
# 2. a backend on that database with ANTHROPIC_API_KEY set, on :5199
# 3. the eval
EVAL_DATABASE_URL=postgresql://postgres:test@localhost:15499/fuelsense_test \
  npm run eval:fuelbrain                     # all cases
npm run eval:fuelbrain -- --only parked-not-broken --reps 3
npm run eval:fuelbrain -- --dry-run          # fixture + case list, no model calls
```

Results go to `.claude/hillclimb/fuelbrain/baseline/` (`results.jsonl` plus
one transcript per case in `traces/`). The runner prints the pass rate with a
95% confidence interval and the token cost. It deliberately does not load
`backend/.env`, whose `DATABASE_URL` is production, and refuses any database
that isn't local, including the production tunnel.
