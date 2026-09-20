---
id: reading-metrics
title: Reading the metrics
sidebar_position: 5
---

# Reading the metrics

A guide to what the numbers mean, which ones to look at first, and how to ask
Prometheus a question yourself. [Metrics and logs](/operations/observability)
covers how to run the stack; this page is about reading it.

## Start here

```bash
cd backend && npm run prom:prod
```

That opens the stack **and** an SSH tunnel to the EC2 box, so Grafana shows
production, not the laptop. Two dashboards, both with an **Environment** picker
at the top left — choose `prod`:

| Dashboard | Question it answers |
| --- | --- |
| **FuelSense backend** | Is telemetry arriving? Which tracker went quiet? Are packets being discarded? |
| **FuelSense runtime** | Is the process healthy? Memory, CPU, event loop, the DB pool, API latency and errors, Redis. |

Hover the **(i)** on any panel: every one says what a bad reading looks like.

## The five numbers to check first

If you only look at five things, look at these, in this order.

### 1. `fuelsense_tcp_frames_total` — is telemetry arriving at all?

*Backend dashboard → "AVL records / min".*

A counter of AVL records committed to the database. Everything else in the
product is downstream of it. **Flat at zero while a vehicle is in use is the
worst failure the system has** — it looks exactly like "the vehicle did not
move", and nothing else alerts on it.

Reads: parked fleet → a slow trickle (the tracker still reports on its stop
cadence). Driving → 10–60 per minute per vehicle. Zero for 45 minutes with
`fuelsense_tcp_devices_connected` also zero → the tracker cannot reach the
server (wrong IP, SIM out of data, power). Zero with the device *connected* →
parse failures, check the next metric.

### 2. `fuelsense_tcp_parse_failures_total` — is telemetry being thrown away?

*Backend dashboard → "Packets discarded (1h)".*

Packets the Codec8E parser rejected. Each one is a whole batch of records,
gone, unrecoverable. Any value above zero is a bug in the decoder or a
firmware change on the tracker, and the `PacketsBeingDiscarded` alert fires on
it. This is the metric that would have caught the 2026-08-09 outage two hours
earlier.

### 3. `fuelsense_nodejs_eventloop_lag_p99_seconds` — is the process choking?

*Runtime dashboard → "Event loop lag".*

Node runs all JavaScript on one thread. Lag is how late a timer fires because
that thread was busy doing something synchronous. It is the single best health
number for a Node service, because *everything* — every HTTP request, every TCP
frame — waits behind it.

| p99 lag | Meaning |
| --- | --- |
| under 20 ms | Normal. Prod idles around 10 ms. |
| 50–200 ms | Something is doing heavy synchronous work: sorting thousands of rows in JS, building a huge JSON, a regex on a large string. Find which request by lining the spike up with "Slowest routes". |
| over 1 s | Requests time out and tracker sockets start dropping. Restart, then find the cause. |

### 4. `fuelsense_db_pool_waiting` — is the database the bottleneck?

*Runtime dashboard → "Waiting for a connection".*

Requests queued because every connection in the `pg` pool is in use. This is
the number that explains **"everything is slow at once"**: no single query is
slow, but each request waits for a free connection before it can even start.
Sustained above zero means either the pool is too small or one query holds a
connection for too long (a sweep doing row-by-row work inside a transaction,
typically).

### 5. `fuelsense_process_resident_memory_bytes` — is it leaking?

*Runtime dashboard → "Memory over time".*

What the operating system charges to the process. The EC2 instance has about
1 GB; the backend runs at ~150 MB. **Read the shape, not the value.**

- Sawtooth (climbs, drops, climbs) — healthy; the drops are garbage collection.
- A line that only climbs, hour after hour, and every restart resets it — a
  leak. Usual suspects: a `Map` keyed by IMEI that never deletes, an event
  listener added per connection and never removed, a `setInterval` never
  cleared. The "Open handles" stat rising alongside points at the last two.
- RSS climbing while "Heap used" stays flat — the leak is native memory:
  `Buffer`s from the TCP parser or the pg client, not JavaScript objects.

## The rest, by question

**Is the API erroring?** `fuelsense_http_request_duration_seconds_count` split
by `status`. The runtime dashboard shows the 5xx share; anything above 0 on
prod is worth opening the logs for. Bulk 401s are an expired session still
polling; bulk 404s are a scanner.

**Which endpoint is slow?** The same histogram, `histogram_quantile(0.95, …)`
grouped by `route`. "Slowest routes (p95)" shows the top eight. Judge it on
`env=prod` only — the laptop reaches RDS through an SSH tunnel and is roughly
thirtyfold slower for the same SQL.

**Is the tracker connected right now?** `fuelsense_tcp_devices_connected`.
Zero while the vehicle is in use means it cannot reach port 5027.

**Which device went quiet?** `fuelsense_tcp_seconds_since_last_frame{imei}`.
Measured from what this process has seen, so it resets on restart.

**Did the deploy lose in-progress state?** `fuelsense_detector_state_ops_total`
with `op="restore"`. After a restart, the first frame from each device reads
its idle/trip/fuel-stop state back from Redis: `outcome="hit"` means the
episode survived, `miss` means there was none to restore, `error` means Redis
was unreachable and the detector started cold. Errors are not an outage — the
store falls back to memory and ingestion continues — but while they persist a
restart forgets an idle stretch in progress.

**Is GC eating the CPU?** `fuelsense_nodejs_gc_duration_seconds_sum` as a
rate, by `kind`. `minor` is constant and cheap. Frequent `major` collections
mean the heap is near its ceiling — it goes with a heap graph that flattens at
the top.

## Asking Prometheus yourself

Grafana → **Explore** → Prometheus datasource, or http://localhost:9090
directly. PromQL in four ideas:

1. **A metric name is a query.** `fuelsense_tcp_devices_connected` returns the
   current value, one line per label combination.
2. **Braces filter by label.** `fuelsense_tcp_frames_total{env="prod"}`.
   `=~` is a regex: `{route=~"/api/telemetry/.*"}`.
3. **Counters only go up, so look at their rate.**
   `rate(fuelsense_tcp_frames_total[5m])` is records per second over the last
   five minutes; multiply by 60 for per-minute. `increase(...[1h])` is the
   total in the last hour. Never graph a raw counter.
4. **Aggregate with `sum`, `max`, `by`.**
   `sum by (route) (rate(fuelsense_http_request_duration_seconds_count[5m]))`
   is requests per second per route.

Queries worth keeping:

```promql
# Records per minute, per device, on prod
rate(fuelsense_tcp_frames_total{env="prod"}[5m]) * 60

# p95 API latency per route, prod, slowest first
topk(5, histogram_quantile(0.95,
  sum by (le, route) (rate(fuelsense_http_request_duration_seconds_bucket{env="prod"}[5m]))))

# Error share over the last 15 minutes
sum(rate(fuelsense_http_request_duration_seconds_count{env="prod",status=~"5.."}[15m]))
  / sum(rate(fuelsense_http_request_duration_seconds_count{env="prod"}[15m]))

# Memory growth per hour — a leak shows as a steady positive number
deriv(fuelsense_process_resident_memory_bytes{env="prod"}[1h]) * 3600

# Restarts in the last day
changes(fuelsense_process_start_time_seconds{env="prod"}[1d])

# Did detector state survive the last restart?
increase(fuelsense_detector_state_ops_total{env="prod",op="restore"}[1h])
```

## Production logs

Loki only tails the laptop backend; the box logs to journald. For prod:

```bash
ssh -i ~/.ssh/fuelsense.pem ec2-user@13.63.114.126 'sudo journalctl -u fuelsense -n 200 --no-pager'
ssh -i ~/.ssh/fuelsense.pem ec2-user@13.63.114.126 'sudo journalctl -u fuelsense -f'            # follow
ssh -i ~/.ssh/fuelsense.pem ec2-user@13.63.114.126 'sudo journalctl -u fuelsense --since "1 hour ago" | grep -i "error\|DATA LOSS\|detector-state"'
```

The bracketed tags the backend prints — `[REAL DEVICE]`, `[DATA LOSS]`,
`[idle_detector]`, `[detector-state]`, `[geofence]` — are the thing to grep for.

## Adding panels and plugins

Dashboards are provisioned from JSON in `ops/observability/grafana/dashboards/`
with UI edits disabled, so a panel you tune in the browser is lost on the next
reload. The workflow that sticks:

1. Build the panel in Grafana (Explore → Add to dashboard is fine).
2. Panel menu → **Inspect → Panel JSON**, copy it.
3. Paste it into the dashboard's JSON file, then `npm run prom:grafana:reload`.

Every panel the two dashboards use is built into Grafana. If you want a plugin
panel or datasource, name it in `GRAFANA_PLUGINS` and it is installed on start:

```bash
GRAFANA_PLUGINS=grafana-polystat-panel npm run prom:grafana
```

Plugin IDs are on https://grafana.com/grafana/plugins/. It is empty by
default on purpose — a download on every boot is a cost the stack should not
pay silently, and nothing here needs one.

## Related

- [Metrics and logs](/operations/observability) — running the stack, label
  cardinality, who can scrape, alert rules
- [Ingest pipeline](/architecture/ingest) — what a frame goes through, and
  which state survives a restart
