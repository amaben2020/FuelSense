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

`Calibration → Fuel economy`, or `POST /vehicles/{id}/economy`.

Enter the long-term average from the vehicle's own trip computer. **The unit is
required, not assumed** — 15 mpg is 6.38 km/L on a US gallon and 5.31 on an
imperial one, a 20% gap in the figure the whole fuel model rests on.

This replaces the class preset. `rate_source` then reads something other than
`preset`, and the dashboard stops describing the figure as a guess.

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

`POST /vehicles/{id}/odometer` with the dashboard reading. The tracker only
counts distance since it was fitted, so true mileage is this baseline plus the
device's counter since the anchor instant.

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

Get this right before the first fill: **a fill to full is measured against
this number**, and a 60 L tank recorded as 55 L makes every full fill look like
5 L walked away.

## 3. Tank anchor — fill it to full

The tank has no sensor, so it needs one exact fact to start from. **A fill to
full is that fact.** Log the fill with "Filled to full" ticked — in the driver
app, or on Receipts → *Add a receipt* in the dashboard — and the model pins the
level at the tank capacity, whatever it had drifted to before.

For a fleet-wide calibration, fill every vehicle and log each one as full,
same day. From that moment:

1. **Every gauge reads full, exactly.** The virtual tank is anchored at
   capacity and burns down from there at the vehicle's rate.
2. **The second full fill measures the real rate.** Litres bought ÷ km driven
   between the two fills × 100 is this vehicle's L/100 km, in its own traffic
   with its own idling. It replaces the catalogue figure automatically and
   `rate_source` becomes `calibrated`. Only full-to-full pairs count — a
   partial top-up in between still credits its litres but teaches nothing,
   because the level at the two ends is not the same.
3. **The odometer comes from the tracker**, not the driver. AVL 16 is the
   vehicle's own total (validated against the dash to 0.03%), read in metres at
   the purchase time. Type a dash reading only if the tracker was not fitted
   yet.
4. **A fill the tank could not have taken** — more litres than the modelled
   headroom plus 8% — is recorded as a discrepancy before the level is pinned,
   so the model's drift is measured, not silently erased.

Five full-to-full intervals make the rolling average; a flagged interval
(odometer did not advance, jumped more than 5,000 km, or disagrees with GPS
by more than 15%) never moves it.

`POST /vehicles/{id}/virtual-tank/calibrate` with a litre figure is the manual
form of the same anchor, for when the level is known without a receipt.
Both write a **marker row** so the step change is never counted as consumption
or mistaken for a siphon. See [The fuel model](/data/fuel-model).

## Verifying it took

```sql
SELECT license_plate,
       consumption_rate_l_per_100km,
       idle_burn_rate_l_per_hour,
       rate_source,
       speed_limit_kph
FROM vehicles;
```

Then check the estimate page: the **Your km/L** column should show the rate you
entered, not a model average. After two full fills, `rate_source` reads
`calibrated` and `real_consumption_l_per_100km` on the second purchase row is
the measured figure:

```sql
SELECT purchased_at, liters_declared, odometer_km, filled_to_full,
       real_consumption_l_per_100km, flag_reason
FROM fuel_purchases WHERE vehicle_id = '…' ORDER BY purchased_at DESC;
```
