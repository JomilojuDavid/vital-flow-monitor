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
- Real IoT integration with load-cell sensors or drip chambers.
- Role-based authentication (head nurse vs. staff nurse).
- SMS/push notifications to on-call staff.
- Ward-level analytics and refill prediction.
- Integration with hospital EMR systems.

---

## Notes for reviewers

- The current IV depletion is a **software simulation** for demonstration purposes, but every numeric calculation is grounded in real biomedical units (gtts/min, ml, macro drip factor).
- Audio uses the **Web Audio API** directly, so no external sound files are required.
- Vibration is a browser feature; the app intentionally detects support and degrades to a visual fallback rather than failing silently.
- Patient data is stored in a **Supabase** table with Lovable Cloud.

---

Built with care for clinical clarity and rapid response.