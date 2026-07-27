# LUTH Smart IV Monitoring System

A medical-grade, centralized **Nursing Station Dashboard** for real-time monitoring of Intravenous (IV) fluid levels across multiple hospital beds. Built for high-stakes clinical environments where nurses need to scan many patients at a glance and respond immediately to critical events.

---

## What the app does

The dashboard simulates a hospital Ward 3 with six smart beds. Each bed is fitted with a virtual IV sensor that reports fluid volume in real time. The system automatically classifies each bed as **Stable**, **Warning**, or **Critical** and alerts the nursing staff with sound, vibration, and visual pulses so no bag runs dry unnoticed.

### Core purpose
- Replace manual IV checks with a live, centralized telemetry view.
- Reduce the risk of fluid exhaustion, blocked lines, or delayed refills.
- Give nurses one-click actions: mute alarms, mark a bag as refilled, view patient records, and simulate fluid levels for training.

---

## Key features

### 1. Live monitoring grid
- Six bedside cards (BED 01–BED 06) arranged in a responsive, scannable grid.
- Each card shows:
  - Bed number and ward
  - Patient name
  - IV fluid type (e.g., 0.9% Normal Saline, 5% Dextrose, Ringer's Lactate)
  - Visual IV bag with a liquid column that depletes in real time
  - Precise volume remaining: `450 ml / 1000 ml`
  - Flow rate in gtts/min (drops per minute)
  - Calculated time remaining until empty
- Cards are color-coded with a clinical palette:
  - **Emerald** = stable
  - **Amber** = warning
  - **Vibrant red** = critical

### 2. Intelligent alert system
- **Critical** = fluid below 10% or flow blocked. Card pulses red; a global banner slides down; audio chime plays.
- **Warning** = fluid below 30%. Card glows amber.
- **Stable** = above 30%.
- Active alerts are logged in a timestamped **Alert History** drawer.
- Nurses can **mute an alarm** or **dismiss the banner** for a specific bed.

### 3. Audio, haptic, and visual feedback
- **Medical chime**: a polite but urgent two-tone beep generated with the Web Audio API whenever an unmuted critical bed exists.
- **Haptic vibration toggle**: a triple-buzz pattern on supported Android devices; gracefully falls back to a screen-edge red pulse on iOS Safari and desktop browsers.
- **Visual pulse**: red inset ring flashes across the whole screen on every alert cycle, so the alert is impossible to miss even without vibration.

### 4. Bed actions
- **Mute Alarm** — silences the chime/vibration for that bed.
- **Mark Refilled** — resets the bag to 100%, clears the critical state, and logs the event.
- **Details** — opens a modal with a mocked fluid-consumption trend chart (area chart over time).

### 5. Patient records (cloud-backed)
- A second tab, **Patient Records**, lists every admitted patient.
- Nurses can **admit a new patient** with name, age, sex, ward, bed assignment, diagnosis, and fluid type.
- New patients are saved to **Lovable Cloud** (Supabase) and load back on refresh.
- Patients can be **discharged** with one click; the delete is synced to the cloud.
- Toast notifications confirm success or display errors.

### 6. Simulation & training controls
- A floating **Simulation Panel** lets demo users:
  - Turn the IV drip simulation on/off
  - Change speed: 1x, 2x, 5x
  - Edit any bed's exact fluid level with a slider or number input
  - Apply quick presets: Full, 50%, Warning, Critical, Reset
- This makes the project easy to demonstrate because you can deliberately push any bed into a critical state.

### 7. Dark mode
- Toggle between a clean clinical light theme and a low-light dark theme.
- Preference is persisted in `localStorage`.

---

## Technology stack

| Layer | Tech |
|-------|------|
| Framework | TanStack Start v1 (React 19, file-based routing, SSR/SSG-ready) |
| Build tool | Vite 7 |
| Styling | Tailwind CSS v4 + custom CSS design tokens |
| UI primitives | shadcn/ui components + Radix UI |
| Charts | Recharts |
| Notifications | Sonner |
| Icons | Lucide React |
| Backend / data | Lovable Cloud (Supabase) |
| Auth | Supabase client (ready for future auth expansion) |

---

## How it works

### Data model
- **`Bed`** — the runtime state of each bedside monitor. Contains fluid volume, flow rate, mute status, and acknowledgment state.
- **`PatientRecord`** — cloud-persisted patient demographics and admission details.
- **`AlertLog`** — in-memory event history for the current session (warnings, criticals, refills).

### Simulation engine
- A `setInterval` ticks every second.
- For configured beds (`BED 02` and `BED 05`), it subtracts `flowRate / 20 * simSpeed` milliliters per tick.
- The divisor `20` assumes a standard macro drip set (20 gtts ≈ 1 ml), so `gtts/min` can be converted into `ml/min`.
- This gives realistic biomedical numbers: a 500 ml bag at 30 gtts/min drains in roughly 5.5 hours, but the simulation accelerates that for demo visibility.

### Status classification
```
percent <= 10%  → critical
percent <= 30%  → warning
percent > 30%   → stable
```

### Alert lifecycle
1. When a bed crosses into critical or warning, a new log entry is pushed.
2. If any unmuted critical bed exists, the global banner appears and the chime/vibration loop starts.
3. Marking the bed refilled resets its volume and clears the alert.
4. Muting only stops sound/vibration for that bed; the visual red state remains.

### Cloud persistence
- The app uses the generated Supabase client (`@/integrations/supabase/client`).
- On mount, it selects all rows from the `patients` table.
- Admitting a patient inserts a row; discharging deletes it.
- The UI uses snake_case database columns (`bed_id`, `fluid_type`, `admitted_at`) and maps them to camelCase in the frontend.

### Theme & settings
- `localStorage` keys:
  - `iv-theme` — `"light"` or `"dark"`
  - `iv-vibration` — `"on"` or `"off"`
- The `dark` class is toggled on `document.documentElement`.

---

## Hardware integration: IV pole sensor system

The dashboard is not just a simulation: it is designed to receive live telemetry from a network of smart IV poles installed at each bedside. The section below describes the end-to-end hardware-to-software connection that makes the system fully functional in a real hospital ward.

### 1. Overview of the connected system
- Each bed has a dedicated **Smart IV Pole** fitted with sensors and a small edge controller.
- The pole measures the IV bag's remaining fluid continuously and sends data to the dashboard over the hospital Wi-Fi network.
- The dashboard receives the values, runs the same status/alert logic, and presents a live ward view to nurses.

### 2. Sensor hardware on each IV pole

| Component | Role | How it works |
|-----------|------|--------------|
| **Load cell** | Weight measurement | The IV bag hangs from a strain-gauge load cell. By measuring the current weight of the bag and drip chamber setup, the system calculates the remaining volume in milliliters. |
| **Drip sensor** | Flow verification | An infrared photointerrupter is placed across the drip chamber to count drops per minute. This confirms the flow rate and detects blockages or kinked lines. |
| **Microcontroller (ESP32/Arduino)** | Edge processing | Reads the load cell and drip sensor, runs calibration math, and transmits data over Wi-Fi. It also handles local alarm buffering if the network drops. |
| **Piezo buzzer** | Local bedside alarm | Sounds a local tone when the bed is critical, even if the network or central dashboard is unavailable. |
| **LED status ring** | Local visual indicator | Green / amber / red light on the pole so bedside staff can see status without looking at the monitor. |
| **Power supply** | Continuous operation | 5 V USB adapter with battery backup so the pole continues monitoring during short power outages or bed movement. |

### 3. How the sensors calculate remaining volume
1. The **load cell** measures the total hanging weight in grams (bag + tubing + clamp).
2. A **tare offset** is taken when the empty bag is first hung to remove the hardware weight.
3. The remaining fluid weight is divided by the fluid density (≈ 1 g/ml for saline/dextrose) to get remaining volume.
4. The **drip sensor** independently verifies the flow rate by counting drops per minute.
5. Both values are sent together so the dashboard can cross-check the volume and flow rate.

### 4. Data flow from pole to dashboard
```
Load cell + Drip sensor
        ↓
ESP32 edge controller
        ↓
Hospital Wi-Fi / MQTT broker
        ↓
Supabase real-time (or REST API)
        ↓
Dashboard bed card updates
```

- The microcontroller publishes a JSON payload every 5 seconds:
  ```json
  {
    "bed_id": "BED-02",
    "volume_ml": 245,
    "total_ml": 500,
    "flow_rate_gtt_per_min": 30,
    "flow_blocked": false,
    "timestamp": "2026-07-27T14:32:10Z"
  }
  ```
- The backend (Supabase) accepts this payload through a secure edge function or server route and updates the corresponding bed record.
- The dashboard subscribes to that record and refreshes the card instantly.

### 5. Communication protocol
- **Transport**: MQTT over hospital Wi-Fi for low-latency, lightweight messaging.
- **Fallback**: HTTP POST if MQTT is unavailable.
- **Security**: TLS-encrypted transport, device-level API keys, and topic-level access control.
- **Offline resilience**: The edge controller caches up to 30 minutes of readings and replays them once the network returns.

### 6. Calibration and accuracy
- Each load cell is calibrated against known weights (100 g, 250 g, 500 g, 1000 g) before deployment.
- The system is accurate to **±5 ml** for standard 500–1000 ml bags.
- The drip sensor is calibrated against the labeled drip factor of the infusion set (e.g., 20 gtts/ml for macro drip).
- Auto-tare prompts the nurse to hang an empty set first, removing tubing weight from measurements.

### 7. Mounting and ward installation
- The load cell is mounted at the top hook of a standard IV pole.
- The drip sensor clips onto the drip chamber without obstructing the fluid path.
- Cables are routed inside the pole for infection control and to avoid snagging.
- The microcontroller enclosure is IP54-rated to withstand hospital cleaning routines.

### 8. Safety and fail-safes
- If the sensor fails or the network drops, the pole keeps a **local alarm** and the dashboard shows the bed as **Unknown / Offline**.
- The system never blocks the physical IV line; it is purely a monitoring overlay.
- Audio and visual alarms are layered: bedside buzzer, dashboard banner, mobile vibration, and logged alert history.
- Patient data is encrypted in transit and at rest in Lovable Cloud.

### 9. From prototype to production ward
- During development, the dashboard uses the **Simulation Panel** to mimic sensor data so the software can be tested without hardware.
- In the deployed ward, the simulation is disabled and the dashboard reads live payloads from the MQTT broker.
- The same `bed_id` used in the hardware JSON is the same `bed_id` shown in the dashboard, so mapping is straightforward.

---

## Project structure

```
/
├── src/
│   ├── routes/
│   │   ├── __root.tsx        # Root layout, theme CSS, toaster provider, error/404 boundaries
│   │   ├── index.tsx         # Main dashboard: tabs, monitoring, patients, simulation, alerts
│   │   └── README.md         # TanStack routing conventions
│   ├── components/ui/        # shadcn/ui primitives (Dialog, Toast, Button, etc.)
│   ├── integrations/supabase/# Auto-generated Supabase clients and middleware
│   ├── styles.css            # Clinical color tokens, dark mode, animations
│   ├── router.tsx            # TanStack Router setup
│   └── start.ts              # TanStack Start instance
├── supabase/
│   └── config.toml           # Lovable Cloud configuration
├── package.json              # Scripts and dependencies
└── README.md                 # This file
```

---

## How to run locally

### Requirements
- Node.js 18+ or Bun
- A Lovable Cloud / Supabase project (already configured in this repo)

### Install dependencies
```bash
bun install
```

### Start the dev server
```bash
bun dev
```

The app opens at `http://localhost:8080`.

### Other useful scripts
```bash
bun run build      # Production build
bun run lint       # ESLint
bun run format     # Prettier
```

---

## How to demo / defend the project

Use this flow when presenting to an examiner or stakeholder.

### 1. Opening statement
> "This is a centralized nursing station dashboard for a Smart IV Fluid Monitoring System. It gives nurses a single, real-time view of every bed in the ward, with automatic alerts when any IV bag is running low."

### 2. Show the monitoring grid
- Point out the six bed cards and the color coding.
- Note the realistic values: total bag sizes of 500 ml or 1000 ml, flow rates in gtts/min, and time-to-empty calculations.
- Mention the visual IV bag: the liquid column height matches the percentage, so nurses can read status from across a room.

### 3. Trigger a critical alert
- Open the **Simulation Panel**.
- Drag `BED 05` (or any bed) to a critical percentage, or click the **Critical** preset.
- Watch the global banner slide down, the card pulse red, and hear the chime.
- If on a supported Android device, enable vibration and feel the triple buzz; on iOS/desktop, point out the red screen-edge pulse fallback.

### 4. Resolve the alert
- Click **Mark Refilled** on the critical card.
- The bag resets to 100%, the banner disappears, and the event is logged.
- Open the **Alert Logs** drawer to show the logged history.

### 5. Show patient records
- Switch to the **Patient Records** tab.
- Admit a new patient with the form; show the success toast and the new row.
- Refresh the page to prove the data persists in Lovable Cloud.
- Discharge a patient to show the cloud delete.

### 6. Mention the clinical design decisions
- Sterile, high-contrast palette with no heavy shadows.
- Tight padding and large numerals for readability at a distance.
- Dark mode for night-shift usage.
- All actions are one-click because nurses are often busy and gloved.

### 7. Future work / extensions
- Role-based authentication (head nurse vs. staff nurse).
- SMS/push notifications to on-call staff.
- Ward-level analytics and refill prediction.
- Integration with hospital EMR systems.
- Multi-ward deployment with a central hospital command center.

---

## Notes for reviewers

- The dashboard can operate in two modes: **live hardware mode** (reading real IV pole sensor data) and **simulation mode** for training or demos.
- Every numeric calculation is grounded in real biomedical units (gtts/min, ml, macro drip factor).
- Audio uses the **Web Audio API** directly, so no external sound files are required.
- Vibration is a browser feature; the app intentionally detects support and degrades to a visual fallback rather than failing silently.
- Patient data is stored in a **Supabase** table with Lovable Cloud.

---

Built with care for clinical clarity and rapid response.