# EV Battery Monitor — IoT Wireless Charging Dashboard

A live React dashboard for an EV battery-management prototype. It reads real-time
telemetry from an IoT controller (published to Firebase Realtime Database under
`BMS_5578`), derives battery state, raises predictive failure alerts, and writes
control commands back to the hardware — drive direction, artificial heating level,
coolant pump relay, and cooling fan relay.

> **Current station-control workflow:** Automatic navigation now uses the controller's
> built-in `BMS_5578/Execute_Path` and `BMS_5578/Path_Name` fields. Reserving first
> writes `Execute_Path = 1`, waits until the controller writes `Ready` back to that
> field, and only then writes the mapped controller path to `Path_Name` (Station 1
> writes path 2; Station 2 writes path 1). The `/BMS` branch
> supplies four-station `Current*`, `Voltage*`, and `Switch*` (or `Relay*`) telemetry;
> the dashboard mirrors those switches to complementary `green1`…`green4`,
> `red1`…`red4`, and `Relay1`…`Relay4` outputs. A charging relay is first energised only
> when the reserved station's ultrasonic distance is below 20 cm, then remains latched
> until Stop or 100% completion. Older saved-route
> descriptions later in this document describe the retained legacy helpers, not the
> current Auto-mode UI.

After the Ready handshake, the selected `Path_Name` remains set. The dashboard does
not automatically write `0`; only an explicit **Stop vehicle** command clears it.

The dashboard covers the full journey: **monitor the battery → detect a low/overheat
condition → find and reserve a nearby wireless charging station → drive the vehicle
there with the joystick or a saved auto route → dock and charge wirelessly → review
health and alerts.**

---

## Table of Contents

1. [Feature Summary](#1-feature-summary)
2. [System Architecture](#2-system-architecture)
3. [How the Project Works (End-to-End)](#3-how-the-project-works-end-to-end)
4. [Firebase Data Contract](#4-firebase-data-contract)
5. [Derived Values and Safety Logic](#5-derived-values-and-safety-logic)
6. [Predictive Failure Detection](#6-predictive-failure-detection)
7. [Getting Started](#7-getting-started)
8. [Complete Dashboard Guide](#8-complete-dashboard-guide)
9. [Full Operating Walkthrough](#9-full-operating-walkthrough)
10. [Configuration and Tuning](#10-configuration-and-tuning)
11. [Project Structure](#11-project-structure)
12. [Deployment (GitHub + Vercel)](#12-deployment-github--vercel)
13. [Troubleshooting](#13-troubleshooting)
14. [Prototype Limitations](#14-prototype-limitations)

---

## 1. Feature Summary

| Area | What it does |
| --- | --- |
| Live telemetry | Vehicle voltage, station voltage, current, temperature, heating level, pump relay, fan relay and drive direction — streamed from Firebase with no polling |
| Battery state | Live SOC is voltage-derived before a trip; reservation starts a 50–75% journey simulation that drains toward 25% while moving and rises only during relay-confirmed charging |
| Manual driving | A five-button joystick that writes `F` / `B` / `L` / `R` / `S` straight to `BMS_5578/direction` |
| Auto driving | One-click station reservation writes `Execute_Path = 1`, waits for `Ready`, then writes the mapped controller path to `Path_Name` |
| Live path feedback | `Slot1`…`Slot4` provide vehicle-to-station distance and drive the journey progress/arrival animation |
| Reserve & go | Station 1 → path 2, Station 2 → path 1, Station 3 → path 3, Station 4 → path 4 |
| 3D animation | The same scaled 120 × 160 cm route map on Overview, Drive Control and Charging, with a top-view car, current-step guidance, completed-path tracking and final-position reporting |
| 360° camera | Orbit the scene a full turn with the mouse — drag to look around, scroll to zoom, right-drag to pan, one button to reset |
| Alerts | 12 rule-based alerts covering low battery, overheating, voltage/current/SOC instability, slow charging, repeated overheat, frequent cooling, and BMS offline |
| Thermal safety | After the `Execute_Path = Ready` handshake, Relay2 cycles 5 seconds ON / 5 seconds OFF regardless of direction or temperature. Heat % still controls temperature rise, and a 30 °C safety request overrides the cycle until cooling reaches 27 °C |
| Stations | 4 live stations with switch-driven green/red state, current/voltage/power graphs, slot distance, reservation, and Three.js animation |
| Wireless charging | A valid ultrasonic echo below 20 cm requests the reserved station relay; charging time/energy begin only after `RelayN = 1` feedback |
| Health | Alert table with severity/status, event log with real timestamps, and operator acknowledgement |

---

## 2. System Architecture

```
┌───────────────────────┐        writes         ┌────────────────────────┐
│  IoT / BMS Controller │  ──────────────────▶  │  Firebase Realtime DB  │
│  (ESP32 / Arduino)    │                       │    /BMS_5578  (live)   │
│                       │  ◀──────────────────  │    /auto_routes (saved)│
│  • Voltage1 (vehicle) │        reads          └───────────┬────────────┘
│  • Voltage2 (station) │                                   │
│  • Current sensor     │                        onValue()  │  set()
│  • Temperature sensor │                        streaming  │  commands
│  • Relay1 coolant pump│                                   ▼
│  • Relay2 cooling fan │                       ┌────────────────────────┐
│  • Heater (Heat %)    │                       │   React 19 Dashboard   │
│  • Motor driver       │                       │  (Vite + Context API)  │
└───────────────────────┘                       └───────────┬────────────┘
                                                            │
                                                Browser Geolocation API
                                                 (vehicle live position)
```

**Layers in the app**

| Layer | File | Responsibility |
| --- | --- | --- |
| Transport | [src/firebase.js](src/firebase.js) | Initialises the Firebase app and RTDB handle |
| Device I/O | [src/state/bms.js](src/state/bms.js) | Telemetry subscriptions, command writers (`setDirection`, `setHeat`, `setPumpRelay`, `setFanRelay`, `setCooling`) and route CRUD (`subscribeRoutes`, `saveRoute`, `deleteRoute`) |
| State machine | [src/state/store.js](src/state/store.js) | Pure reducer, derived SOC/SOH, station computation, alert rules, event log |
| Side effects | [src/state/EvContext.jsx](src/state/EvContext.jsx) | Subscriptions, timers, geolocation watch, automatic cooling, heating cut-off, hash routing |
| 3D view | [src/components/Scene3D.jsx](src/components/Scene3D.jsx), [src/components/VehicleScene.jsx](src/components/VehicleScene.jsx) | Lazy-loaded three.js scene; reads live state through a ref so telemetry never rebuilds the scene |
| UI | [src/screens/](src/screens/), [src/components/](src/components/) | Six screens plus a persistent sidebar |

All state lives in **one reducer**. Screens only read state and dispatch actions or
call a `bms.js` writer — no screen talks to Firebase directly except through those
helpers.

---

## 3. How the Project Works (End-to-End)

### 3.1 Telemetry ingestion

On mount, [EvContext.jsx](src/state/EvContext.jsx) opens two Firebase listeners:

- `subscribeBmsData()` — an `onValue` stream on the `/BMS_5578` node. Every hardware
  write fires a `BMS_UPDATE` action carrying the whole snapshot.
- `subscribeConnection()` — watches `.info/connected` to drive the **IoT Cloud Link**
  online/offline badge and the `offline` alert.

Because it is a stream, there is no refresh interval — the UI updates the moment the
controller writes a value.

### 3.2 Reducer processing

Each `BMS_UPDATE` is processed in [store.js](src/state/store.js):

1. **Parse and clamp** every field. Any field missing from the snapshot keeps its
   previous value, so a partial write never blanks the dashboard.
2. **Derive SOC** from `Voltage1` and **SOH** from temperature/voltage.
3. **Detect edge transitions** — battery crossing into low SOC, into the warning
   temperature band, into critical, or either cooling relay flipping. Each transition
   appends a timestamped line to the event log.
4. **Apply safety interlocks** — pause charging on critical temperature, downgrade
   fast → normal charging above the warning limit, mark the session complete at 100%.
5. **Append to rolling history** — a 200-sample / 15-minute window used by the
   sparklines and the predictive rules.
6. **Stamp alert start times** so the Overview alert cards show a genuine "since" clock
   rather than a fabricated one.

### 3.3 Control write-back

Three `useEffect` controllers in `EvContext.jsx` push commands back to the hardware,
and the drive controls write on click:

| Controller | Trigger | Write |
| --- | --- | --- |
| Dashboard heating | `Heat` slider above 0% and fan OFF | Raises `Temp` from 0.1–0.6 °C/s according to Heat % |
| Manual fan override | Operator presses Manual Fan ON/OFF | Keeps both fan relay paths ON until Manual OFF is pressed; automatic timers cannot cancel the override |
| Path fan cycle | `Execute_Path` reports `Ready` and the path reservation is confirmed | `BMS_5578/Relay2` and `/BMS/Relay` cycle 5 seconds ON, 5 seconds OFF, independent of direction and temperature |
| Automatic fan | Temperature ≥ 30 °C | Both fan relay paths become `1`; temperature cools by 0.5 °C/s and cannot rise while the fan is ON |
| Fan hysteresis | Temperature ≤ 27 °C | Both fan relay paths return to `0` |
| Safety stop | Vehicle arrives, or the operator halts it | `direction = 'S'` |
| Manual joystick | Operator presses a pad button | `direction = 'F' \| 'B' \| 'L' \| 'R' \| 'S'` |
| Auto route playback | Each step's turn comes up | That step's `direction`, held for the step's duration, then `'S'` at the end |

### 3.4 Location and stations

A `navigator.geolocation.watchPosition` watch keeps the vehicle's live coordinates in
state. Station distance uses the **haversine** formula and bearing the standard
great-circle formula, both in [src/utils/geo.js](src/utils/geo.js); the bearing is
mapped to a 16-point compass label. Stations are always re-sorted nearest-first.

A station's position is resolved in priority order:

1. `Station{N}Lat` / `Station{N}Lng` published by the hardware (`locationSource: iot`)
2. A small offset from the vehicle's own GPS position, so the demo shows realistic
   0.5–1.5 km neighbours (`locationSource: prototype`)
3. Hard-coded fallback coordinates (`locationSource: default`)

### 3.5 Reservation → drive → charging chain

```
RESERVE_STATION ──▶ Execute_Path = 1 ──▶ wait for "Ready"
       │
Path_Name = mapped controller path ──▶ vehicleStatus: 'moving'
       │
selected SlotN > 0 and < 20 cm ──▶ 'S' written, vehicle reached + alignment confirmed
       │
selected RelayN = 1 requested ──▶ wait for `/BMS/RelayN = 1` feedback
       │
relay confirmed ON ──▶ charging timer/energy calculation starts, Charging opens
       │
TICK ──▶ simulated SOC rises to 100 % ──▶ charging stops and "Vehicle Full" is displayed
       │                         selected RelayN returns to OFF
```

Automatic charging is sensor-driven and uses only the reserved station's ultrasonic
field (`Slot1`…`Slot4`). Only a value greater than 0 and below 20 cm triggers arrival;
`0`, `-1`, and values of 20 cm or more cannot start it. After arrival, the relay request
is latched so sensor fluctuations cannot interrupt charging. The ultrasonic value detects arrival only; charging calculations
remain stopped until the selected station's relay reports ON.

Safety can interrupt this chain at any point: critical temperature pauses charging, and
fast mode is blocked whenever the battery is above the warning limit.

---

## 4. Firebase Data Contract

Live telemetry lives under **`/BMS_5578`**; saved auto routes live under
**`/auto_routes`**. The dashboard reads every field it knows and ignores anything else,
so extra keys are harmless.

### `/BMS_5578` — live telemetry

| Key | Type | Direction | Meaning |
| --- | --- | --- | --- |
| `Voltage1` | number | hardware → app | **Vehicle pack voltage** — the source for SOC |
| `Voltage2` | number | hardware → app | **Charging-station voltage** measured at the station |
| `Current` | number | hardware → app | Pack current in amps |
| `Temp` | number | hardware → app | Battery temperature in °C |
| `Heat` | 0–100 | **both** | Artificial heating level as a percentage |
| `Relay1` | 0 \| 1 | **both** | **Coolant pump** — 1 while the battery is too hot |
| `Relay2` | 0 \| 1 | **both** | **Cooling fan** — 1 while the battery is too hot |
| `direction` | string | **both** | Drive command — see below |

### Drive commands (`direction`)

| Value | Meaning |
| --- | --- |
| `F` | Forward |
| `B` | Backward |
| `R` | Left |
| `L` | Right |
| `S` | Stop |

### `/auto_routes` — saved auto-drive routes

Written by the dashboard when you create, edit or delete a route. Kept outside the
telemetry node so the controller's live stream carries only live values.

```json
{
  "auto_routes": {
    "route_1788460234610": {
      "name": "Bay 1 approach",
      "steps": [
        { "direction": "F", "seconds": 5 },
        { "direction": "L", "seconds": 10 },
        { "direction": "R", "seconds": 8 },
        { "direction": "B", "seconds": 9 }
      ],
      "updatedAt": 1788460234610
    }
  }
}
```

### Optional station fields

All optional — supply them under `/BMS_5578` to replace the prototype defaults.

| Key | Type | Meaning |
| --- | --- | --- |
| `Slot1` … `Slot4` | number | Ultrasonic distance in cm. `0`/`-1` = invalid or no echo; `1`–`40` cm = object/robot detected; above 40 cm = not yet at station |
| `Station{N}Filled` | number | Occupied bays, overrides the slot-sensor inference |
| `Station{N}Total` | number | Total bays at that station (default 1) |
| `Station{N}Lat` / `Station{N}Lng` | number | Real station coordinates |
| `Station{N}Name` | string | Display name for that station |
| `Station{N}Current` / `Station{N}Voltage` | number | Electrical readings for stations 2–4 (station 1 uses `Current` and `Voltage2`) |

The station-control branch `/BMS` exposes `Relay1`…`Relay4`. The dashboard writes the
selected relay to `1` after ultrasonic arrival and waits for that same relay value to be
observed before starting the charging timer and energy integration.

### Example live snapshot

```json
{
  "BMS_5578": {
    "Current": 0,
    "Heat": 0,
    "Relay1": 0,
    "Relay2": 0,
    "Temp": 28.9,
    "Voltage1": 0.71,
    "Voltage2": 0.71,
    "direction": "S"
  }
}
```

---

## 5. Derived Values and Safety Logic

### State of Charge (SOC)

The controller publishes no direct SOC percentage, so it is derived linearly from the
vehicle pack voltage (`Voltage1`) and clamped to 0–100 %:

```
SOC = (Voltage1 − 9.5) / (12.6 − 9.5) × 100
```

When a station reservation starts, journey simulation takes over: SOC is clamped into
the requested 50–75% starting range, falls by 0.1 percentage point per second while
the vehicle is moving (never below 25%), and rises by 0.5 point per second only while the selected
station relay is confirmed ON. Live voltage continues to be displayed but does not
overwrite the simulated journey SOC.

> **You will almost certainly need to change this.** `9.5 V` and `12.6 V` are the
> pack's empty and full voltages. If your sensor reports a scaled value (the live node
> currently reads `0.71`), every reading falls below the empty point, SOC pins at 0 %
> and the low-battery alert never clears. Set `SOC_VOLTAGE_MIN` / `SOC_VOLTAGE_MAX` in
> [src/state/store.js](src/state/store.js) to your sensor's real empty/full range.

### State of Health (SOH)

Starts at 100 % and is penalised for thermal and under-voltage stress, then clamped to
40–100 %:

```
SOH = 100 − min(30, (Temp − 45) × 1.5)   when Temp > 45 °C
        − 10                             when Voltage1 < 9.5 V
```

### Other derived values

| Value | Formula |
| --- | --- |
| State of Discharge | `100 − SOC` |
| Range estimate | `SOC × 3.1` km |
| Live charging power | `abs(Voltage1 × Current)` watts |
| Energy delivered | Power integrated every second: `energyWh += watts / 3600` |
| Station 1 power | `abs(Current × Voltage2)` watts |
| Bay occupied / robot detected | Slot reading between `1` and `40` cm |

### Thermal thresholds

| Constant | Value | Effect |
| --- | --- | --- |
| Fan-off threshold | 27 °C | Automatic fan releases at or below this hysteresis point |
| `WARN_TEMP` | 30 °C | Automatic fan engages |
| `CRITICAL_TEMP` | 40 °C | Critical-temperature alert |
| `LOW_SOC_THRESHOLD` | 15 % | Low-battery alert with nearest-station shortcuts |
| `HEAT_SAFETY_THRESHOLD` | 65 % heat | Proactively engages cooling before the battery gets hot |

---

## 6. Predictive Failure Detection

Beyond threshold alarms, the app keeps a rolling **15-minute / 200-sample** history and
compares consecutive readings. These are rule-based early warnings, not a validated
diagnosis.

| Alert | Rule | Severity |
| --- | --- | --- |
| Low battery | SOC ≤ 15 % | High |
| Battery overheated | Temp ≥ 30 °C | High |
| Critically overheated | Temp ≥ 40 °C | High |
| Heating level too high | `Heat` ≥ 65 % | High |
| Repeated overheat | ≥ 3 overheat events in 15 min | High |
| Frequent cooling | ≥ 3 pump activations in 15 min | Medium |
| Voltage instability | Drop ≥ 1.0 V between consecutive readings | High |
| Current instability | Swing ≥ 2.0 A between consecutive readings | Medium |
| Rapid temperature rise | Rise ≥ 3.0 °C between consecutive readings | High |
| SOC instability | Jump ≥ 10 % between consecutive readings | Medium |
| Slow charging | < 1 % SOC gained after 5 min of active charging | Medium |
| BMS offline | Firebase `.info/connected` is false | Medium |

When no rule fires, a single resolved **"No active battery alerts"** row is shown.

---

## 7. Getting Started

### Prerequisites

- **Node.js 20.19+ or 22.12+** (required by Vite 8)
- A Firebase project with **Realtime Database** enabled
- An IoT controller writing to the `/BMS_5578` node (or write values manually in the
  Firebase console to test)
- A browser with geolocation permission — distances and directions need it

### Install and run

```bash
npm install
npm run dev        # dev server with hot reload -> http://localhost:5173
```

### All scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint across the project |

### Firebase configuration

The database URL is set in [src/firebase.js](src/firebase.js):

```
https://diet-planner-3bdf3-default-rtdb.firebaseio.com
```

Realtime Database reaches the server through `databaseURL` alone, so that field is the
only one that must be correct. Paste your real `apiKey`, `messagingSenderId` and
`appId` from **Firebase Console → Project settings → Your apps** if you later add Auth,
Storage or Analytics.

For a prototype with no authentication, the database rules must allow reads and writes:

```json
{
  "rules": {
    "BMS_5578":    { ".read": true, ".write": true },
    "auto_routes": { ".read": true, ".write": true }
  }
}
```

> **Security note:** public rules suit a lab prototype but not a deployment. Before
> going public, lock the rules down to authenticated clients and move the config into
> Vite environment variables (`VITE_*` in a git-ignored `.env`).

### First run checklist

1. `npm run dev` and open the printed URL.
2. **Allow** the browser's location prompt when asked.
3. Check the sidebar's **IoT Cloud Link** badge reads **Online** (green).
4. Confirm the Overview metric cards show real numbers, not `—`. A dash means no data
   has arrived on `/BMS_5578` yet.

---

## 8. Complete Dashboard Guide

The dashboard is a six-screen single-page app. Navigate with the sidebar or directly via
URL hash — `#overview`, `#stations`, `#navigation`, `#charging`, `#thermal`, `#health`.
The hash stays in sync, so any screen can be bookmarked or reloaded.

### 8.0 The Sidebar (always visible)

| Element | Meaning |
| --- | --- |
| Six nav buttons | Switch screens; the active one is highlighted |
| Vehicle Status | `Ready` → `Moving` → `Arrived` → `Charging` |
| Battery (SOC) + bar | Live charge percentage |
| Battery Health (SOH) | Estimated pack health |
| Range | Estimated remaining kilometres |
| State of Discharge | `100 − SOC` |
| IoT Cloud Link | Green **Online** / red **Offline**, with the last sync clock |

If the link goes red, everything on screen is the **last known value** — no new
telemetry is arriving.

---

### 8.1 Overview — live battery condition

The landing screen, and the one to keep open while the vehicle runs.

**Metric cards.** SOC, SOH (with a plain-language condition — Good / Fair / Service Soon
/ Attention Required), Charge Cycles, **Vehicle Voltage** (`Voltage1`), **Station
Voltage** (`Voltage2`), Current, and Temperature. The temperature card turns red above
65 °C.

**Toast alerts.** Each newly raised alert pops a toast in the top corner for 6 seconds.
It appears once per alert; it re-appears only if the condition clears and returns.

**Alerts panel.** Every active alert as an expandable card with a title, description,
and the clock time it started.

- **Thermal alerts** carry inline cooling controls: an **Automatic / Manual** mode
  toggle plus **Turn ON / Turn OFF Cooling** buttons that drive both relays together.
  The buttons are only enabled in Manual mode — in Automatic mode the app owns them.
- The **Low battery** alert lists the three nearest stations with distance and free
  slots, plus a **Find a charging station →** shortcut.

**Trend sparklines.** Rolling history for Current, Temperature, SOC, SOH, and Charge
Cycles, each with its live value.

**Status strip.** Vehicle state, charge state, **Coolant pump** `ON`/`OFF`, **Cooling
fan** `ON`/`OFF`, and the live drive direction with its letter.

**Station strip.** All four stations as chips with free-slot counts; clicking any chip
jumps to the Stations screen.

---

### 8.2 Stations — find and reserve a charging bay

Lists all four wireless charging stations, always sorted nearest-first.

**Location bar.** Shows the vehicle's live GPS coordinates. **Refresh Current Location**
forces a fresh high-accuracy fix. If location is blocked, distances and directions show
`—` and the Directions button is disabled.

**Each station card shows:**

| Field | Meaning |
| --- | --- |
| Status dot | Available (green) / Occupied (red) / Reserved (blue) / Charging (teal) |
| Distance · Compass | Live haversine distance and 16-point bearing |
| Slot summary | Available / filled / total bays |
| Current · Voltage · Power | Live transmitter readings — station 1 uses `Current` and `Voltage2` |
| Transmitter | `ACTIVE` while charging, otherwise `STANDBY` |
| Activation | `ARMED` when this station is selected, else `READY` |
| Engagement | `Not engaged` → `Reservation pending` → `Vehicle en route` → `Docking engaged` → `Charging engaged` |
| IoT link | `LIVE` / `OFFLINE` |

**Buttons on each card:**

- **Reserve** — selects the station (only available stations can be selected). Click
  again on the selected card, now labelled **Reserve & Navigate**, or use the side
  panel's confirm button.
- **Directions** — opens Google Maps driving directions from the vehicle's live position
  to that station in a new tab.
- **Simulate Occupied / Free Slot** — writes `BMS_5578/Slot{N}` to fake a vehicle in
  that bay. Use this to demo occupancy handling without physical hardware.

**Right-hand panel** (after selecting a station) shows the full reservation detail, an
**Auto route to drive** picker, a three-step progress list, and the confirm button.

**Auto route to drive.** The vehicle only ever drives directions you have already
saved, so the panel lists every route under `/auto_routes` as a radio option with its
step count, total run time, and step chips. Picking one changes the button to
**Confirm & Play "<route name>"**; until you pick one the button stays disabled. If no
routes exist yet, the panel says so and offers a **Create a route →** shortcut to Drive
Control.

**How to use it:**

1. Confirm the location bar shows coordinates.
2. Pick an **Available** station and click **Reserve**.
3. Choose which saved route should drive the vehicle there.
4. Click **Confirm & Play** — the station is locked, the app switches to Drive Control,
   and the route starts playing straight away.

---

### 8.3 Navigation — Vehicle Drive Control

This is where you actually drive the vehicle. Two modes, switched with the **Manual /
Auto** toggle at the top.

**Drive status banner.** Plain-language status plus the **live command** currently
sitting in `BMS_5578/direction`.

**Live route map.** A three.js representation of the 120 × 160 cm demonstration sheet.
A small top-view car always starts at the bottom centre `(60 cm, 0 cm)`. During playback,
a yellow guide shows only the current command ahead of the car; future steps remain
hidden. The completed path is retained in cyan, and the ending position is marked and
reported in centimetres.

**Looking around.** The camera is fully free:

| Gesture | Does |
| --- | --- |
| Left-drag | Orbit a full 360° around the subject, from ground level up to overhead |
| Scroll | Zoom in and out (4–36 units) |
| Right-drag | Pan the view |
| **Reset view** | Restore the starting angle and distance |
| **Reset point** | Return the car to `(60 cm, 0 cm)` and clear its completed path |

Whatever angle and distance you choose is kept as the vehicle drives — the camera moves
*with* it rather than snapping back, so the subject never leaves the frame. The pitch
stops just above the horizon so the camera cannot end up below the ground.

#### Manual mode — joystick

A five-button pad laid out the way you would expect:

```
          ▲ Forward (F)
◀ Left (L)   ■ Stop (S)   ▶ Right (R)
          ▼ Backward (B)
```

Pressing a button writes that single letter to `BMS_5578/direction` immediately. The
command **stays latched** until you press another button — the pad highlights whichever
one is currently active (Stop highlights red), and the readout underneath repeats it.

#### Auto mode — saved routes

Build a named sequence of timed directions, save it to Firebase, and replay it.

**Saved Routes list.** Every route stored under `/auto_routes`, showing its name, step
count, total run time, and each step as a chip (`F 5s`, `L 10s`, `R 8s`, `B 9s`), with
three buttons:

- **▶ Play** — starts the route. Each step's letter is written to `direction` and held
  for that step's duration, then the next step fires. When the last step ends, `S` is
  written automatically.
- **Edit** — loads the route into the editor. Saving keeps the same id, so it updates
  in place rather than creating a copy.
- **Delete** — removes the route from Firebase.

**Route editor** (`+ New route`, or `Edit`):

- **Route name** — must be unique; duplicates are rejected with a message.
- **Steps** — each row is a direction dropdown (Forward / Backward / Left / Right /
  Stop) and a seconds box (0.1–600, in 0.1-second / 100 ms increments). Reorder with **↑ / ↓**, remove with **✕**, and add
  more with **+ Add step**. The total run time updates as you edit.
- **Save route** / **Update route** writes to `/auto_routes`; **Cancel** discards.

#### Testing a timing before you save it

Guessing how far "forward for 5 seconds" actually moves the vehicle is the hard part of
writing a route, so the editor can drive the hardware for real while you are still
editing — no saving required.

| Control | Does |
| --- | --- |
| **▶ Test** on a step row | Sends just that step's direction for just that step's duration, then writes `S` |
| **▶ Test all steps (Ns)** | Runs the whole draft in order, exactly as saving and playing it would |
| **Stop test** | Ends the trial immediately and writes `S` |

> **A test moves the real vehicle.** It writes the same letters to
> `BMS_5578/direction` that a saved route does. The only difference is bookkeeping —
> nothing is written to `/auto_routes`, and finishing a test never marks the vehicle
> arrived or advances a reservation.

While a test runs, the playback panel is amber and labelled **Test run — not saved**,
and **Save route** is disabled so a half-finished trial cannot be committed by accident.
Adjust the seconds, test again, and press **Save route** only once the timing is right —
the two are independent, so you can test as many times as you like before saving.

**While a route plays**, a panel shows the route name, `Step 2 / 4`, the current
direction, a live seconds countdown, and a progress track of all steps (done / current /
pending). **Stop route** halts it and writes `S`.

The 3D route view represents the physical **120 × 160 cm demonstration sheet** at
10 cm per scene unit. A small top-view car starts at the bottom centre `(60 cm, 0 cm)`.
Only the current direction is shown ahead as live guidance; future route steps stay hidden.
The car follows the active route timing while its completed path is recorded separately.
The final position is marked and reported.
**Reset point** returns the car to the starting position and clears the travelled path when no route is running.

Playback is cancelled and `S` written if you switch to Manual, press **Stop vehicle**,
delete the running route, or leave the screen.

**Side panel.** Live motor command, drive mode, GPS distance and compass bearing to the
reserved station, and live readings for temperature, current, vehicle voltage and
station voltage. Below that, the route-progress checklist, the wireless-charging
prompt, and a red **Stop vehicle** button that always sends `S` immediately.

---

### 8.4 Charging — wireless charging session

**Live Vehicle Route Position.** Charging uses the same 120 × 160 cm map, top-view car,
current-step guidance and completed-path presentation as Overview and Drive Control.
The animation no longer switches to a separate docking or energy-ring scene.

**Summary bar.** Selected station, Arrival Confirmed/Pending, Coil Alignment
Confirmed/Pending, and a Cooling Active flag showing pump and fan state.

**Charging Status card.** The current mode (Fast / Normal / Paused / Fully charged),
SOC, State of Discharge, and Temperature, plus a charge progress bar and session
statistics:

| Statistic | Meaning |
| --- | --- |
| Session time | `MM:SS` since the session became active |
| Live BMS power | `abs(Voltage1 × Current)` in watts, right now |
| Energy delivered | Watt-hours integrated once per second over the session |
| BMS SOC | Live charge percentage |
| Vehicle voltage | `Voltage1` |
| Station voltage | `Voltage2` |
| Current | Live pack current |

At 100% SOC, charging stops automatically and a prominent **Vehicle Full — 100%
Charged** message replaces the active/standby status.

**Safety checks.** Battery connected, Temperature safe, Station confirmed — each green
when satisfied.

**Modes.** Four buttons with real interlocks:

- **Fast** — requires coil alignment *and* temperature below 65 °C. Disabled otherwise,
  and automatically downgraded to Normal if the battery heats up mid-session.
- **Normal** — the standard active mode.
- **Paused** — stops charging without ending the session.
- **Complete** — display-only; set automatically at 100 % SOC.

Above 70 °C every mode button is disabled and a "Charging paused" note explains that
charging resumes automatically once the battery cools.

---

### 8.5 Thermal Control — heating, cooling, and safety

**Five status cards.**

| Card | States |
| --- | --- |
| Temperature Status | `NORMAL` / `WARNING` (≥ 30 °C) / `CRITICAL` (≥ 40 °C) |
| Coolant Pump (Relay1) | `ON` (coolant flow active) / `OFF` |
| Cooling Fan (Relay2) | `ON` (extracting heat) / `OFF` |
| Charging Status | `ACTIVE` / `NORMAL ONLY` / `PAUSED` |
| Heater & Driver | `STANDBY` / `HEATING` / `SAFETY LOCKED`, with live heat % |

**Cooling Control (Liquid Cooling).** Shows the warning and critical thresholds and a
system summary of pump, fan, heater pad and temperature sensor.

- **Automatic fan** — the dashboard Heat % control raises `Temp` at a proportional
  rate. At 30 °C the app forces `Heat = 0` and switches fan `Relay2` to 1. While ON,
  temperature falls by 0.5 °C/s and cannot increase; the fan releases at 27 °C.
- **Manual** — enables **Turn cooling ON / OFF** (both relays together) plus individual
  **Pump (Relay1)** and **Fan (Relay2)** toggles.

**Artificial Battery Heating (Heat %).** A 0–100 % slider writing to `BMS_5578/Heat`,
plus **Turn heater ON** (sets 40 %) and **Turn heater OFF**. It exists to raise battery
temperature deliberately so the thermal-safety chain can be demonstrated.

The slider is the temperature-increase control. **Turn heater OFF** stops additional
heating; automatic fan cooling takes priority whenever the limit is reached.

**Thermal loop diagram.** A live schematic of the sensor, heater pad, battery pack,
coolant pipes, and pump + fan, animating with the real relay states, heat level, and
temperature.

**Overheat card.** When the battery is hot, a red card lists the actions to take and
offers **Acknowledge Alert**, which records the acknowledgement in the event log.

---

### 8.6 Health & Alerts — diagnostics and history

**Status summary.** `Nominal` or `Inspection recommended`, followed by every observed
event in plain language.

**Alert summary table.** Every alert with its severity pill (High / Medium / Low) and
status (Active or Resolved).

**Event log.** Toggle **View event log** for the last 30 timestamped events — low
battery reached, safety limit crossed, heating cut off, pump/fan switched, drive mode
changed, manual and auto direction commands, reservation confirmed, vehicle stopped,
coil aligned, charging paused, session complete, connection lost/restored, and operator
acknowledgements.

**Acknowledge.** Records that an operator reviewed the health advisory.

---

## 9. Full Operating Walkthrough

A complete demo run, start to finish:

1. **Start the app** — `npm run dev`, allow location, confirm the sidebar shows
   **Online**.
2. **Watch Overview** — metric cards fill with live vehicle voltage, station voltage,
   current, temperature, SOC and SOH; sparklines begin building history.
3. **Open Drive Control.** In **Manual** mode, press **Forward** — `F` goes straight to
   `BMS_5578/direction`, and the 3D vehicle drives forward with it. Try **Left**,
   **Right**, **Backward**, then **Stop**.
4. **Switch to Auto.** Click **+ New route**, name it, and build
   `F 5s → L 10s → R 8s → B 9s` with **+ Add step**.
   Press **▶ Test** on a row to drive just that step and see how far it actually goes,
   or **▶ Test all steps** to trial the whole sequence. Nudge the seconds and test again
   until it is right, then **Save route** — it appears under `/auto_routes` in Firebase.
5. **Play it.** Each direction is sent in turn with a live countdown, and the 3D vehicle
   traces the route you programmed. **Stop route** cancels early.
6. **Edit and delete.** Reopen the route with **Edit**, change a timing, **Update
   route** — same id, updated in place. **Delete** removes it.
7. **Open Stations** and reserve an available station. The controller handshake starts
   the selected station path.
8. **Approach the reserved station.** When its `SlotN` ultrasonic sensor detects the
   robot at a valid distance below 20 cm, the dashboard stops it, requests the relay, and waits for relay
   ON feedback before calculating charging.
9. **Watch the session** — mode, SOC, session timer, live power and energy delivered.
   At 100% it stops and displays **Vehicle Full**.
10. **Demonstrate thermal automation** — raise **Heat %** on Thermal Control. Temperature
    rises according to the selected level. At **30 °C**, Heat turns OFF and the fan turns
    ON automatically. Temperature cools by 0.5 °C/s, and the fan turns OFF at **27 °C**.
11. **Review Health & Alerts** — the alert table shows every rule that fired and the
    event log gives the timestamped story of the whole run.

---

## 10. Configuration and Tuning

Every tunable constant is at the top of [src/state/store.js](src/state/store.js):

```js
const WARN_TEMP = 65;                     // °C — pump+fan on, heat cut, fast charge off
const CRITICAL_TEMP = 70;                 // °C — charging paused
const SAFE_TEMP = 60;                     // °C — pump+fan release (hysteresis)
const LOW_SOC_THRESHOLD = 15;             // % — low-battery alert
const HEAT_SAFETY_THRESHOLD = 65;         // % heat — proactive cooling

const SOC_VOLTAGE_MIN = 9.5;              // V — pack empty  (set to your sensor range)
const SOC_VOLTAGE_MAX = 12.6;             // V — pack full   (set to your sensor range)

const HISTORY_WINDOW_MS = 15 * 60 * 1000; // predictive-rule window
const HISTORY_MAX_SAMPLES = 200;
const VOLTAGE_DROP_THRESHOLD = 1.0;       // V
const CURRENT_SWING_THRESHOLD = 2.0;      // A
const TEMPERATURE_RISE_THRESHOLD = 3.0;   // °C
const SOC_JUMP_THRESHOLD = 10;            // %
const REPEATED_OVERHEAT_COUNT = 3;
const FREQUENT_COOLING_COUNT = 3;
const SLOW_CHARGE_MIN_MINUTES = 5;
const SLOW_CHARGE_MIN_GAIN = 1;           // % SOC
```

Also worth changing for a real deployment:

- **`OCCUPIED_DISTANCE_CM`** (40 cm) — the slot-sensor distance that counts as occupied.
- **`STATION_COORDS`** — fallback station coordinates.
- **Range factor** in [Sidebar.jsx](src/components/Sidebar.jsx) — `SOC × 3.1` km.
- **`MAX_STEP_SECONDS`** (600) in [Navigation.jsx](src/screens/Navigation.jsx) — the
  longest a single auto-route step may run.
- **`BMS_PATH` / `ROUTES_PATH`** in [bms.js](src/state/bms.js) — the Firebase node names.
- **`STATION_SPOTS`, `DRIVE_SPEED`, `TURN_RATE`, `YARD_HALF`** in
  [VehicleScene.jsx](src/components/VehicleScene.jsx) — the 3D yard layout and how fast
  the on-screen vehicle drives and turns.
- **`minDistance` / `maxDistance` / `maxPolarAngle`** on the `OrbitControls` in the same
  file — how far the camera may zoom and how high it may climb.

---

## 11. Project Structure

```
KS5578/
├── index.html                  # Vite entry, page title
├── vite.config.js              # Vite + React plugin
├── eslint.config.js            # ESLint (react-hooks, react-refresh)
├── package.json
└── src/
    ├── main.jsx                # React root
    ├── App.jsx                 # Provider + screen router (hash-based)
    ├── App.css, index.css      # Theme tokens and all styling
    ├── firebase.js             # Firebase app + RTDB initialisation
    ├── state/
    │   ├── bms.js              # Telemetry subscriptions, commands, route CRUD
    │   ├── store.js            # Reducer, derived values, station logic, alert rules
    │   └── EvContext.jsx       # Provider, subscriptions, timers, control effects
    ├── screens/
    │   ├── Overview.jsx        # Metrics, alerts, trends, status strip
    │   ├── Stations.jsx        # Station list, reservation, directions
    │   ├── Navigation.jsx      # Manual joystick + auto route builder/player
    │   ├── Charging.jsx        # Wireless charging session
    │   ├── Thermal.jsx         # Heating, pump/fan control + thermal diagram
    │   └── Health.jsx          # Alert table and event log
    ├── components/
    │   ├── Sidebar.jsx         # Navigation + persistent battery summary
    │   ├── Scene3D.jsx         # Lazy-loading wrapper + card chrome for the 3D view
    │   ├── VehicleScene.jsx    # three.js yard, vehicle kinematics, charging rings
    │   ├── ui.jsx              # PageHeader, Card, InfoNote, ProgressBar, Sparkline
    │   └── icons.jsx           # Inline SVG icon set
    └── utils/
        ├── geo.js              # Haversine distance, bearing, compass labels
        └── format.js           # Clock formatting
```

**Tech stack:** React 19 · Vite 8 · Firebase 12 (Realtime Database) · three.js 0.185 ·
plain CSS · Context + `useReducer` (no external state library or router).

three.js is loaded through `React.lazy`, so its ~134 kB gzipped chunk is fetched only
when the Drive Control or Charging screen is opened, not on first paint.

---

## 12. Deployment (GitHub + Vercel)

The app is a static Vite build — no server, no environment variables required — so
Vercel needs no configuration beyond pointing it at the repo.

> ### Read this before you make the URL public
>
> Firebase's web config always ships inside the client bundle; that is normal and
> unavoidable. What matters is the **database rules**. While `/BMS_5578` and
> `/auto_routes` are world-writable, **anyone who opens the deployed link can drive the
> vehicle** — press Forward, toggle the heater and relays, or delete saved routes.
>
> Until the rules are locked down (see [Getting Started](#7-getting-started)), treat the
> URL as a private demo link and only power the hardware on while you are watching it.

### Step 1 — push to GitHub

The repo already has a commit and a remote:

```bash
git remote -v
# origin  https://github.com/SpherenexLabs/advance_battery-_management_system.git
git push -u origin main
```

If that returns `403 ... denied to <account>`, the Git credential stored on this machine
belongs to an account without write access to the repo. Pick whichever fits:

| Situation | Fix |
| --- | --- |
| You own the `SpherenexLabs` org | Add the account named in the error as a collaborator with **Write** access, then re-run the push |
| You have a different GitHub account with access | Clear the saved credential and let Git ask again: Windows **Credential Manager → Windows Credentials → `git:https://github.com`** → Remove, then `git push -u origin main` |
| You would rather use your own repo | Create an empty repo on GitHub, then point the remote at it: `git remote set-url origin https://github.com/<you>/<repo>.git` followed by `git push -u origin main` |

A personal access token works as the password at the prompt — a classic token needs the
`repo` scope, a fine-grained one needs **Contents: Read and write** on that repository.

### Step 2 — deploy on Vercel

The GitHub route is the simplest and needs no CLI:

1. Go to **[vercel.com/new](https://vercel.com/new)** and sign in with GitHub.
2. **Import** the repository you just pushed.
3. Vercel detects Vite automatically — leave every field as offered:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
4. Press **Deploy**.

Your live link appears as `https://<project-name>.vercel.app` when the build finishes.
Every later `git push` to `main` redeploys it automatically.

Prefer the terminal? `npm i -g vercel`, then `vercel login` and `vercel --prod` from the
project root. Both commands open a browser to authenticate.

### Deployment notes

- **HTTPS is required for geolocation**, and Vercel serves HTTPS by default — station
  distance and compass bearing will work on the deployed site but not over plain `http`.
- **Routing needs no rewrite rules.** The dashboard navigates by URL hash
  (`#overview`, `#navigation`, …), so every screen is served by the same `index.html`.
- **three.js is a lazy chunk.** The first visit to Drive Control or Charging fetches an
  extra ~139 kB gzipped; the initial page load does not pay for it.

---

## 13. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| All metrics show `—` | Nothing has been written to `/BMS_5578` yet. Check the controller and confirm the node exists in the Firebase console. |
| **SOC stuck at 0 % and a permanent low-battery alert** | `Voltage1` is below `SOC_VOLTAGE_MIN`. Set `SOC_VOLTAGE_MIN` / `SOC_VOLTAGE_MAX` in `store.js` to your sensor's actual empty/full range. |
| IoT Cloud Link shows **Offline** | Wrong `databaseURL` in [src/firebase.js](src/firebase.js), no internet, or database rules denying reads. |
| Distances and bearings show `—` | Location permission denied or unavailable. Click **Refresh Current Location** on the Stations screen and allow the prompt. Chrome requires `localhost` or HTTPS for geolocation. |
| Joystick buttons do nothing | Database rules deny writes. Confirm `direction` changes in the Firebase console when you press a button. |
| Auto route list stays empty | `/auto_routes` has no entries yet, or rules deny reads on that node. |
| Confirm Reservation is disabled | No saved route is selected. Pick one in **Auto route to drive**, or create a route on Drive Control first. |
| **Save route** is greyed out | A test run is in progress. Let it finish or press **Stop test**. |
| A test moved the vehicle but nothing was saved | That is intended — testing drives the hardware, saving is a separate button. |
| 3D view says WebGL unavailable | The browser or device has no WebGL. Everything else on the screen still works. |
| Scrolling over the 3D view zooms instead of scrolling the page | That is the 3D viewport taking the wheel gesture. Move the pointer off the scene to scroll the page. |
| Lost the vehicle in the 3D view | Press **Reset view** to restore the default angle and distance. |
| A route keeps driving after you leave | It shouldn't — leaving the screen writes `S`. If the vehicle keeps moving, the controller is not reading `direction`; check the firmware's subscription. |
| Fan turns back ON after manual OFF | Temperature is still at or above 30 °C; automatic protection re-enables it. |
| Temperature does not rise | Set Heat above 0%. Heating is intentionally blocked while the automatic fan is ON. |
| Fast charging is disabled | Coil alignment has not yet been confirmed. |
| Vite refuses to start | Node version too old. Vite 8 needs Node 20.19+ or 22.12+. |

---

## 14. Prototype Limitations

Known constraints, stated plainly:

- **SOC is voltage-derived**, not coulomb-counted, and the default voltage range does
  not match the current sensor output — see the note in §5.
- **SOH is a heuristic**, not a measured capacity-fade figure.
- **Failure detection is rule-based**, not a trained model. Validated prediction needs
  labelled fault history and model evaluation, and the thresholds should be tuned
  against your battery datasheet before any production use.
- **Auto-route timing is open-loop.** Steps are held for wall-clock seconds; there is no
  odometry, encoder or GPS feedback confirming the vehicle actually travelled that far.
  The GPS distance and bearing readouts *are* real.
- **Auto-charging arrival is sensor-driven.** It depends on the reserved station's
  `SlotN` ultrasonic reading being greater than 0 and below 20 cm; tune and validate
  the physical sensor before production use.
- **The 3D view is an illustration, not a digital twin.** It integrates the live
  `direction` command over time with fixed speed and turn rates, so it shows what the
  vehicle was *told* to do — not surveyed position. The map is scaled to the 120 × 160 cm
  demonstration sheet, but its position remains an estimate until a physical tracker is connected.
- **The 3D vehicle carries no battery readout.** SOC, health and thermal state are read
  from the metric cards, sidebar and Thermal screen; the 3D view is purely the vehicle
  and the yard.
- **Station coordinates default to offsets** from the vehicle's own position when the
  hardware publishes no `Station{N}Lat`/`Lng`. Publish real coordinates for real
  distances.
- **Database rules are public**, which suits a lab prototype but must be locked down
  before deployment.
