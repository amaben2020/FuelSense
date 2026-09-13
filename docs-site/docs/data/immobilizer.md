---
id: immobilizer
title: Remote immobilizer
sidebar_position: 7
---

# Remote immobilizer — how a click becomes a cut starter circuit

The Theft panel can stop a vehicle from starting and let it start again. This
page is the whole technique, from the relay under the dash to the bytes on the
wire, so every claim in the UI can be checked against Teltonika's own
documentation and against the code.

Source documents:

- Teltonika **FMC SMS/GPRS Commands** (FMC130 and FMC150 share the table) —
  the `setdigout` row is the command used here. The wiki
  (`wiki.teltonika-gps.com/view/FMC130_SMS/GPRS_Commands`) sits behind a
  Cloudflare challenge; the same table is mirrored as a PDF at
  `device.report` and is attached to the project chat.
- Teltonika **Automotive Relay** accessory page and **Immobilizer
  configuration explained** (same wiki) — the wiring.
- Teltonika **Codec** page, "Codec 12" section — the GPRS command framing.
- Teltonika **FMC150 Teltonika Data Sending Parameters ID** — AVL 179, 180, 248.

## 1. The hardware: one output pin and one relay

The FMC130 and FMC150 each carry two open-collector digital outputs, **DOUT1**
and **DOUT2**. An output does nothing on its own; a relay wired to it does. The
install Teltonika documents for engine blocking is a standard automotive relay
(12 V or 24 V to match the vehicle):

| Relay pin | Wired to |
| --- | --- |
| 85 | tracker **DOUT1** (the output sinks to ground when high) |
| 86 | vehicle +12 V / +24 V |
| 30 | starter (or fuel-pump) signal line, one side |
| 87a | starter signal line, other side — **normally closed** |
| 87 | not used |

With DOUT1 low the coil is idle, 30–87a is closed, the starter line is intact
and the vehicle starts. With DOUT1 high the coil energises, 30–87a opens and
the starter line is interrupted: the vehicle cannot start. Because the
normally-closed contact is used, a tracker with no power leaves the vehicle
drivable — the immobilizer fails safe.

FuelSense assumes this relay is on DOUT1. That is a constant in
`backend/src/lib/immobilizer.ts` (`RELAY_OUTPUT = 1`), not something the
software can detect: a `setdigout` sent to a tracker with nothing wired to
DOUT1 is a command the vehicle never feels.

## 2. The command: `setdigout`

From the FMC command reference, verbatim:

```
setdigout ## Y1 Y2 Z1 Z2      Set digital output.
  1.#  – 0; 1 or ? (0 - OFF, 1 – ON, ? - Ignore) for DOUT1.
  2.#  – 0; 1 or ? (0 - OFF, 1 – ON, ? - Ignore) for DOUT2.
  Y1   – timeout value for DOUT1 if needed (in seconds).
  Y2   – timeout value for DOUT2 if needed (in seconds).
  Z1   – maximum speed value for DOUT1 if needed.
  Z2   – maximum speed value for DOUT2 if needed.
```

The two commands FuelSense sends (`backend/src/lib/teltonika-dout.ts`,
`buildSetDigout`):

| Action | Command | Meaning |
| --- | --- | --- |
| Immobilize | `setdigout 1?` | DOUT1 on, DOUT2 untouched, no timeout, no speed condition — stays on until told otherwise |
| Mobilize | `setdigout 0?` | DOUT1 off, DOUT2 untouched |

The device answers with the levels it now holds:

```
DOUTS are set to:10 TMOs are: 0 0
```

`10` is DOUT1 = 1, DOUT2 = 0; `TMOs are: 0 0` means no timeout on either.
`parseSetDigoutReply` reads this and `levelFromReply(reply, 1)` gives the level
of the relay output.

Timeouts and the speed ceiling (`Y`, `Z`) exist in the syntax and the builder
supports them, but FuelSense deliberately sends neither: immobilizing is a
manager's decision and nothing on the vehicle's side — not speed, not
ignition — is allowed to delay or condition it.

Related commands in the same table, **not** used here:

- `setigndigout` — the same, but the device waits until ignition is off before
  applying it.
- `getio` — reads back DIN/DOUT/AIN levels on demand.
- `lvcanblockengine` / `lvcanunblockengine` — blocks the engine through the
  vehicle's CAN bus; needs an LV‑CAN200/ALL‑CAN300 adapter this fleet does not
  have.

## 3. SMS versus GPRS: same command, two transports

Every Teltonika command can travel two ways, and the text is identical:

**SMS.** A phone sends `<login> <password> setdigout 1?` to the SIM in the
tracker (the login/password pair is set in the Configurator's SMS security
settings; with none set the command is sent bare). The device replies by SMS.
This is what you do from a phone with no server involved, and it works with
no data plan. It is not what FuelSense uses: it needs an SMS gateway, costs
per message, and the reply has nowhere to land in the dashboard.

**GPRS, Codec 12.** The tracker already holds a TCP connection to the FuelSense
server to deliver its AVL data. Codec 12 is the frame Teltonika defines for
sending a command *down that same socket* and getting the reply back on it.
That is what the dashboard uses, because the answer arrives in the same
process that draws the UI.

The consequence: a GPRS command can only be delivered while the tracker has
its socket open. There is no server-initiated path to a device that is not
connected. So when a manager clicks Immobilize on a vehicle whose tracker is
offline, the command is **queued** in the database and sent on the tracker's
next handshake — the panel shows "Command queued · waiting for the tracker to
reconnect" until then.

## 4. The bytes on the wire

Codec 12 frame, server → device (`backend/src/lib/codec12.ts`; the SDK's
`TeltonikaCodec12Command` produces the identical bytes):

```
00000000   preamble
00000014   data size = 20
0c         codec 12
01         one command
05         type 5 = command
0000000c   command length = 12
7365746469676f757420313f   "setdigout 1?"
01         one command (again)
0000ded1   CRC-16/IBM over the bytes from the codec byte to the second 01
```

Full frame for immobilize:

```
00000000000000140c01050000000c7365746469676f757420313f010000ded1
```

and for mobilize (`setdigout 0?`):

```
00000000000000140c01050000000c7365746469676f757420303f0100001e80
```

Device → server reply, same shape with **type 6**:

```
00000000000000290c010600000021
444f555453206172652073657420746f3a313020544d4f73206172653a20302030
010000e6c7
```

which is `DOUTS are set to:10 TMOs are: 0 0`. The SDK's `TeltonikaCodec12Parser`
recognises the frame (preamble zeros, byte 8 = `0x0c`, byte 10 = `0x06`) and
the TCP server's `response` listener hands the text to
`handleCommandReply`.

## 5. The AVL elements involved

The command tells the device what to do. The AVL records tell you what it is
actually doing, independently of any reply:

| AVL | Name | Values | Role here |
| --- | --- | --- | --- |
| **179** | Digital Output 1 | 0 low, 1 high | The relay-side truth. Every record carries it once the element is enabled in the Configurator's I/O tab. `handleDoutReading` stores it on the device row (`dout1_state`, `dout1_reported_at`) and it is the third step in the panel's trail. |
| 180 | Digital Output 2 | 0 / 1 | The central-locking pulse (section 8). |
| 239 | Ignition | 0 / 1 | Not a condition for anything; shown for context. |
| 248 | Immobilizer (scenario) | 0 no key, 1 authorised, 2 unauthorised | The device's *own* iButton/RFID authorisation feature — a different product. Catalogued so it is recognised if a fleet ever enables it; FuelSense does not use it. |

The real FMC150 on the reference fleet does **not** currently send 179: its
15 enabled elements are listed in *What the hardware sends*. Until Digital
Output 1 is ticked in the Configurator, the panel's third step says so rather
than pretending. The simulated fleet sends 179 and 180 in every record.

## 6. The lifecycle the panel shows

Three facts, each from a different place, each shown as its own step:

| Step | Evidence | Where it comes from |
| --- | --- | --- |
| Command sent | `immobilizer_sent_at` | this server wrote the Codec 12 frame to the open socket (`immobilizer_queued_at` set but `sent_at` null = queued) |
| Tracker replied | `immobilizer_ack` | the device's `DOUTS are set to:…` text, verbatim, with its time |
| DOUT1 reads high/low | `dout1_state` | AVL 179 in a later data record |

Phases derived from those columns: `released`, `engage_queued`,
`engage_sent`, `engaged` (reply seen), `engaged_confirmed` (AVL 179 agrees),
`release_queued`, `release_sent`.

## 7. Why it cannot happen by accident

Immobilizing must only ever be a person's explicit decision. The guarantees,
in order from the wire inward:

1. **One code path.** Only `POST /api/vehicles/:id/immobilizer/engage` can
   raise DOUT1. No alert, watchdog, scheduler or theft detector calls it, and
   the simulator only acts on a Codec 12 command it receives.
2. **Authenticated manager session.** The route sits behind
   `authenticateCustomer`; driver tokens use a different path and cannot reach
   it. The vehicle must belong to the caller's customer.
3. **Explicit intent in the request.** The body must carry both
   `confirm: true` (the boolean, not a string) and the vehicle's own licence
   plate. Anything else is refused with 400 before any database write
   (`engageIntentError`, tested in `tests/immobilizer-intent.test.ts`). The
   dashboard's yes/no modal is the only client that sends both.
4. **No double engage.** A vehicle already immobilized, or with a command in
   flight, refuses a second engage with 409.
5. **Audit row every time.** Each engage and mobilize inserts an
   `immobilizer_engaged` / `immobilizer_released` alert naming the actor, the
   exact command and whether it was sent or queued.
6. **Unrequested output is flagged, not adopted.** If AVL 179 reads high on a
   vehicle that was never immobilized from here, the panel shows a warning
   rather than switching to "Immobilized" — the commanded state and the
   observed state are kept separate on purpose.

Mobilize (`setdigout 0?`) has no preconditions beyond authentication: there
is no unsafe moment to restore a starter circuit, and it supersedes any engage
still waiting in the queue.

## 8. Central locking on DOUT2

The second output is free on both the FMC130 and FMC150, and Teltonika's
anti-theft material uses it the same way as DOUT1: through its own relay.
Wired to the central-locking module's lock line, a short pulse locks every
door the way the key fob does.

| Action | Command | Meaning |
| --- | --- | --- |
| Lock doors | `setdigout ?1 ? 1` | DOUT1 untouched, DOUT2 on with a **1 s timeout** — the device drops it itself |

Reply: `DOUTS are set to:01 TMOs are: 0 1`. AVL 180 carries DOUT2's level,
though a one-second pulse rarely lands inside a record.

What it can and cannot do, stated plainly in the panel:

- Works on any vehicle that **has** central locking, however old — the relay
  only needs the module's lock trigger wire. A vehicle without central
  locking feels nothing.
- It is a lock pulse, not a "jam": doors can still be opened from inside, and
  a driver with the key can unlock as normal.
- Only sent to a tracker with a live connection. Unlike immobilize it is
  never queued — a lock pulse arriving hours later is not what anyone asked
  for — so the button is disabled while the tracker is offline.
- Same explicit-intent guard as immobilize (`confirm: true` + plate) on
  `POST /api/vehicles/:id/immobilizer/lock-doors`; every pulse writes a
  `doors_locked` alert naming the actor.

The alternative Teltonika route — `lvcanclosealldoors` / `lvcanopenalldoors`
over the vehicle's CAN bus — needs an LV‑CAN200/ALL‑CAN300 adapter and a
vehicle on Teltonika's supported list. Neither is the case here, so it is not
offered.

## 9. Code map

| File | Role |
| --- | --- |
| `backend/src/lib/teltonika-dout.ts` | `setdigout` builder/parsers, reply parser, AVL 179/180/248 constants |
| `backend/src/lib/codec12.ts` | Codec 12 frame encode/decode (device side; the SDK does the server side) |
| `backend/src/lib/immobilizer.ts` | intent guard, queue, delivery, reply and AVL 179 handling, door-lock pulse, status |
| `backend/src/tcp-server.ts` | `response` listener, queue flush on handshake, AVL 179 per record |
| `backend/src/routes/vehicles.ts` | `GET /:id/immobilizer`, `POST …/engage`, `POST …/release`, `POST …/lock-doors` |
| `backend/src/lib/simulator.js` | the virtual FMC150: obeys `setdigout`, replies, sends 179/180, parks while DOUT1 is high |
| `frontend/src/components/dashboard/TheftPanel.tsx` | vehicle dropdown, yes/no modals, three-step trail, Lock doors |
| `frontend/src/components/dashboard/Immobilizer3D.tsx`, `ImmobilizerSceneModal.tsx` | the "View feature" scene: the car driving, the cut, the dead vehicle, the mobilize |
| `backend/tests/teltonika-dout.test.ts`, `backend/tests/immobilizer-intent.test.ts` | protocol round-trips against the SDK; the intent guard |
