---
id: calibration
title: Calibration
sidebar_position: 2
---

# Calibration

Three different settings share the word "calibration". Doing them out of order
wastes the work.

```mermaid
flowchart LR
  A["1 · Configurator profile<br/>on the device"] --> B["2 · Economy + limits<br/>in FuelSense"] --> C["3 · Tank anchor<br/>current level"]
```

:::warning Order matters
Anchoring the tank **before** the Configurator profile is set anchors it to a
burn rate the device is about to stop using, and the anchor has to be thrown
away again.
:::

## Fitting a new tracker

The FMC130 and FMC150 speak the same protocol (Codec 8 Extended) and share the
AVL IDs FuelSense reads, so both onboard the same way.

1. **Register the IMEI first.** Add the vehicle in onboarding, or *Add vehicle*
   on the dashboard, with the 15-digit IMEI from the device sticker and the
   tracker model. The server **drops any IMEI it does not know**, and stores
   nothing from it — a tracker powered on before it is registered is simply
   ignored until it is.
2. **Pick make, model and year.** Tank size and the EPA city mpg fill in; type
   the trip-computer figure instead if you have it.
3. **Enter the dashboard odometer**, in the unit the dash shows.
4. **Point the device at FuelSense** in the Configurator: server domain
   `tcp.fuelsense.ng`, port **5027**, protocol TCP, codec 8 Extended. A domain
   rather than an IP means a server move never needs the Configurator opened
   again.
5. **Check it arrived:** the vehicle shows *Tracker last seen* within a minute
   of the ignition going on, and `devices.last_seen_at` is set.

Verified on 2026-09-28 against a throwaway database: an FMC130 registered
through onboarding was accepted on the handshake, its records were stored and
the tank burned from them; an unregistered IMEI was dropped.

## 1. The Teltonika Configurator

Set on the device itself, with the Teltonika Configurator tool.

### Fuel consumption profile

| Field | Suggested | Note |
| --- | --- | --- |
| City consumption | 12.5 L/100 km | Referenced at 30 km/h |
| Average consumption | 10.0 L/100 km | Referenced at 60 km/h |
| Highway consumption | 8.5 L/100 km | Referenced at 90 km/h |
| Consumption on idling | 1.4 L/h | The default 1.0 is low for a 2.5 L with AC |
| Correction coefficient | 1 | Leave until two receipts disagree |

Leaving these at defaults is why AVL 12 emits garbage — see
[What the hardware sends](/data/avl-elements).

### I/O elements worth enabling

| Element | Priority | Gives you |
| --- | --- | --- |
| Fuel Used GPS (12) | Low | The burn accumulator, in ml |
| Fuel Rate GPS (13) | Low | Cross-check for the accumulator |
| External Voltage (66) | Low | Vehicle battery health |
| Battery Voltage (67) | Low | Tracker backup cell |
| Trip Odometer (199) | Low | Required by continuous counting |

Anything enabled here appears in `/telemetry/vehicle-signals` immediately, with
no backend change.

### Scenarios

Green Driving and Overspeeding are **off** by default. FuelSense derives both
from GPS regardless, so enabling them is optional — but if you do enable
Overspeeding, set the same limit in FuelSense so the two agree.

## 2. Settings in FuelSense

### Fuel economy

Set for you when the vehicle is added. Pick make, model and **year** and the
economy field fills in with that model year's **EPA city rating** — a 2013 RAV4
shows 23 mpg — and the form says where it came from. Leave it and the vehicle
runs on that figure (`rate_source = catalogue`). See
[Where the rate comes from](/data/fuel-model#where-the-rate-comes-from).

If the vehicle's trip computer shows a different long-term average, type that
instead: it wins, and is stored as `manual`. The same override is at
`Calibration → Fuel economy`, or `POST /vehicles/{id}/economy`. **The unit is
required, not assumed** — 15 mpg is 6.38 km/L on a US gallon and 5.31 on an
imperial one, a 20% gap in the figure the whole fuel model rests on. Clearing
the override returns the vehicle to its EPA figure.

A trip-computer figure is treated as **all-in**: it already averages that
vehicle's idling and its mix of city and highway, so nothing is added on top.

### Speed limit

`Calibration → Speed limit`, or `POST /vehicles/{id}/speed-limit`.

Set it to the same limit configured on the tracker — for example `100`. Until
this is set, **no overspeeding is reported at all**; FuelSense will not choose a
threshold on your behalf.

```bash
curl -X POST https://api.fuelsense.ng/api/vehicles/$VEHICLE_ID/speed-limit \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"speedLimitKph": 100}'
```

Because detection runs over stored frames, setting a limit today also finds
overspeeding in the **past** — a device-side event never could.

### Odometer baseline

`Settings → Vehicle odometers`, or `POST /vehicles/{id}/odometer` with the
dashboard reading in km. The tracker only counts distance since it was fitted,
so true mileage is this baseline plus the device's counter since the anchor
instant. Entered at onboarding, it is taken as the baseline and the tracker's
own starting count does not matter — a newly fitted tracker reading 0 km is
handled the same as one configured with the dash total.

**Re-read it after the tracker has been offline.** Anything the dashboard is
ahead of ours is distance the tracker missed; it is charged to the tank at the
vehicle's rate and recorded in the change history. The first reading, a lower
reading, and a jump over 1,500 km book nothing — see
[Distance the tracker missed](/data/fuel-model#distance-the-tracker-missed).

### Tank size

Chosen for you when the vehicle is added: pick make, model and **year** and
the tank capacity fills in from the catalogue for that year's generation — a
2013 RAV4 is 60 L, a 2020 one 55 L; a 2009 Camry 70 L, a 2014 one 64 L, a 2020
one 60 L; every Corolla since 2003 is 50 L. Twin-tank models (Land Cruiser,
Prado) list the **total** both tanks take at a fill to full, with the split in
the note. The figure is editable, and the form says where it came from.

The API refuses a tank outside 20–600 L, a year the model was not sold in, or
a figure less than half or more than double the manufacturer's — those are
typos, not variants. A long-range tank or a disconnected sub-tank still fits
inside that band.

Get this right before the first fill: the tank cannot hold more than this, so
a 60 L tank recorded as 55 L caps every fill 5 L short.

## 3. Tank anchor

The tank has no sensor, so it starts from the level set on it. When the level
is known — the vehicle has just been filled, or the gauge is read carefully by
the manager — set it with `POST /vehicles/{id}/virtual-tank/calibrate` and a
litre figure (omit it for a full tank). This writes a **marker row** so the
step is never counted as consumption or mistaken for a siphon. See
[The fuel model](/data/fuel-model).

From then on the level moves on its own:

1. **Burn** comes off at the vehicle's rate for every km the tracker counts,
   plus idle.
2. **Receipts** add their litres — nothing more. Neither the driver app nor the
   manager's *Add receipt* asks whether the tank was filled to full or what the
   gauge read (E, ¼, ½…); both questions pinned the level to a guess and
   overrode the litres just bought, and are gone. See
   [Receipts only add litres](/data/fuel-model#receipts-only-add-litres).
3. **Missed distance** comes off when the manager re-reads the odometer after
   an outage.

A fill the tank could not have taken — more litres than the modelled headroom
— is recorded as a `fuel_discrepancy` before the level is capped at full, so the
model's drift is measured, not silently erased.

## Verifying it took

```sql
SELECT license_plate,
       consumption_rate_l_per_100km,
       idle_burn_rate_l_per_hour,
       rate_source,
       speed_limit_kph
FROM vehicles;
```

Then check the estimate page: the **Your km/L** column should show the rate in
force, and trip history's **MPG** column the same figure. A 2013 RAV4 on its
EPA rating reads 23 mpg, `rate_source = catalogue`.

The odometer history shows any distance booked for a tracker outage:

```sql
SELECT changed_at, previous_baseline_km, new_baseline_km,
       gap_km, gap_fuel_liters, gap_rate_l_per_100km
FROM odometer_audit WHERE vehicle_id = '…' ORDER BY changed_at DESC;
```
