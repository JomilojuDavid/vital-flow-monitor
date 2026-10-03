import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BellOff,
  Bell,
  CheckCircle2,
  Clock,
  Droplet,
  Droplets,
  Gauge,
  History,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
  User2,
  Users,
  Vibrate,
  VibrateOff,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LUTH · Smart IV Monitoring System" },
      {
        name: "description",
        content:
          "Centralized nursing station dashboard for real-time IV fluid monitoring across hospital beds.",
      },
      { property: "og:title", content: "LUTH · Smart IV Monitoring System" },
      {
        property: "og:description",
        content:
          "Real-time IV fluid level monitoring, critical alerts, and bedside telemetry for nursing staff.",
      },
    ],
  }),
  component: Dashboard,
});

// ---------- Types & seed data ----------

type Status = "stable" | "warning" | "critical";

interface Bed {
  id: string;
  name: string;
  patient: string;
  ward: string;
  totalMl: number;
  currentMl: number;
  flowRate: number; // gtts/min
  fluidType: string;
  muted: boolean;
  ackCritical: boolean;
}

type EnrichedBed = Bed & {
  percent: number;
  status: Status;
  telemetryAvailable: boolean;
};

// Single-bed deployment: one ESP32 smart IV pole is connected to the dashboard.
const INITIAL_BEDS: Bed[] = [
  { id: "BED 01", name: "BED 01", patient: "Adeyemi J.", ward: "Ward 3 · A", totalMl: 0, currentMl: 0, flowRate: 0, fluidType: "0.9% Normal Saline", muted: false, ackCritical: false },
];

// The one bed wired to a physical smart IV pole.
const LIVE_BED_ID = "BED 01";
// A live reading older than this is treated as offline.
const LIVE_STALE_MS = 30_000;


function getStatus(percent: number): Status {
  if (percent <= 10) return "critical";
  if (percent <= 30) return "warning";
  return "stable";
}

function timeRemaining(currentMl: number, flowRate: number): string {
  // gtts/min: assume 20 gtts/ml (macro drip). ml/min = gtts / 20
  const mlPerMin = flowRate / 20;
  if (mlPerMin <= 0) return "—";
  const mins = Math.max(0, Math.round(currentMl / mlPerMin));
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m left`;
}

// ---------- Audio chime ----------

function useChime(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    const play = () => {
      try {
        if (!ctxRef.current) {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          ctxRef.current = new AC();
        }
        const ctx = ctxRef.current!;
        if (ctx.state === "suspended") void ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } catch {
        /* noop */
      }
    };
    play();
    intervalRef.current = window.setInterval(play, 2200);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [active]);
}

// ---------- Dashboard ----------

interface AlertLog {
  id: string;
  bedId: string;
  patient: string;
  level: Status;
  message: string;
  at: Date;
}

interface PatientRecord {
  id: string;
  name: string;
  age: number;
  sex: "M" | "F";
  ward: string;
  bedId: string;
  diagnosis: string;
  fluidType: string;
  admittedAt: Date;
}

interface DbPatient {
  id: string;
  name: string;
  age: number;
  sex: string;
  ward: string;
  bed_id: string;
  diagnosis: string;
  fluid_type: string;
  admitted_at: string;
}

function rowToPatient(r: DbPatient): PatientRecord {
  return {
    id: r.id,
    name: r.name,
    age: r.age,
    sex: (r.sex === "F" ? "F" : "M") as "M" | "F",
    ward: r.ward,
    bedId: r.bed_id,
    diagnosis: r.diagnosis,
    fluidType: r.fluid_type,
    admittedAt: new Date(r.admitted_at),
  };
}


type Tab = "monitoring" | "patients";

function Dashboard() {
  const [beds, setBeds] = useState<Bed[]>(INITIAL_BEDS);
  const [now, setNow] = useState(new Date());
  const [liveState, setLiveState] = useState<{
    recordedAt: Date | null;
    flowBlocked: boolean;
    deviceId: string | null;
    lastError: string | null;
  }>({ recordedAt: null, flowBlocked: false, deviceId: null, lastError: null });

  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [openBedId, setOpenBedId] = useState<string | null>(null);
  const [dismissedBanner, setDismissedBanner] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("monitoring");
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("iv-theme") as "light" | "dark") || "light";
  });
  const [vibrationOn, setVibrationOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("iv-vibration") !== "off";
  });
  const [vibrationSupported, setVibrationSupported] = useState(false);
  const [hapticPulse, setHapticPulse] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("iv-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("iv-vibration", vibrationOn ? "on" : "off");
  }, [vibrationOn]);

  // detect Vibration API support (Android Chrome/Firefox only; iOS + desktop lack it)
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setVibrationSupported(typeof navigator.vibrate === "function");
  }, []);


  // clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // live device telemetry — poll the latest reading every 3 seconds
  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const { data: reading, error } = await supabase
          .from("device_readings")
          .select("bed_id, device_id, volume_ml, total_ml, flow_rate, flow_blocked, recorded_at")
          .eq("bed_id", LIVE_BED_ID)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!active) return;
        if (!reading) {
          setLiveState({
            recordedAt: null,
            flowBlocked: false,
            deviceId: null,
            lastError: "No readings received yet",
          });
          return;
        }
        const recordedAt = new Date(reading.recorded_at);
        if (Number.isNaN(recordedAt.getTime())) {
          throw new Error("Latest telemetry has an invalid recorded_at timestamp");
        }
        setBeds((prev) =>
          prev.map((b) =>
            b.id === LIVE_BED_ID
              ? {
                  ...b,
                  totalMl: reading.total_ml,
                  currentMl: reading.volume_ml,
                  flowRate: reading.flow_rate,
                }
              : b
          )
        );
        setLiveState({
          recordedAt,
          flowBlocked: reading.flow_blocked,
          deviceId: reading.device_id ?? null,
          lastError: null,
        });
      } catch (e) {
        if (!active) return;
        console.error("[Telemetry] Unable to read latest device_readings record", e);
        setLiveState((s) => ({
          ...s,
          lastError: e instanceof Error ? e.message : "Connection failed",
        }));
      }
    };

    poll();
    const t = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, []);

  // a live reading is only trusted for 30 seconds
  const liveAge = liveState.recordedAt
    ? now.getTime() - liveState.recordedAt.getTime()
    : null;
  const liveFresh =
    liveAge !== null && liveAge >= 0 && liveAge <= LIVE_STALE_MS;
  const liveOffline = !liveFresh;

  // derived
  const enriched = useMemo(
    () =>
      beds.map((b) => {
        const telemetryAvailable = liveFresh;
        const currentMl = telemetryAvailable ? b.currentMl : 0;
        const totalMl = telemetryAvailable ? b.totalMl : 0;
        const flowRate = telemetryAvailable ? b.flowRate : 0;
        const percent = telemetryAvailable && totalMl > 0 ? (currentMl / totalMl) * 100 : 0;
        const blocked =
          telemetryAvailable &&
          liveState.flowBlocked &&
          b.id === LIVE_BED_ID;
        return {
          ...b,
          currentMl,
          totalMl,
          flowRate,
          percent,
          status: blocked ? ("critical" as Status) : telemetryAvailable ? getStatus(percent) : "stable",
          flowBlocked: blocked,
          telemetryAvailable,
        };
      }),
    [beds, liveFresh, liveState.flowBlocked]
  );

  const openBed = openBedId ? enriched.find((b) => b.id === openBedId) ?? null : null;

  const criticalBeds = enriched.filter((b) => b.status === "critical");
  const stableCount = enriched.filter((b) => b.telemetryAvailable && b.status === "stable").length;
  const avgRefill = useMemo(() => {
    // avg minutes till empty across all beds
    const mins = enriched.filter((b) => b.telemetryAvailable).map((b) => {
      const mlPerMin = b.flowRate / 20;
      return mlPerMin > 0 ? b.currentMl / mlPerMin : 0;
    });
    if (mins.length === 0) return null;
    const avg = mins.reduce((a, c) => a + c, 0) / Math.max(1, mins.length);
    return Math.round(avg);
  }, [enriched]);

  // log new critical events
  const prevStatusRef = useRef<Record<string, Status>>({});
  useEffect(() => {
    enriched.forEach((b) => {
      const prev = prevStatusRef.current[b.id];
      if (prev !== b.status) {
        if (b.status === "critical") {
          setLogs((l) => [
            {
              id: `${b.id}-${Date.now()}`,
              bedId: b.id,
              patient: b.patient,
              level: "critical" as const,
              message: `${b.id} entered CRITICAL zone (${b.percent.toFixed(0)}%) — IV refill required.`,
              at: new Date(),
            },
            ...l,
          ].slice(0, 50));
        } else if (b.status === "warning" && prev === "stable") {
          setLogs((l) => [
            {
              id: `${b.id}-${Date.now()}`,
              bedId: b.id,
              patient: b.patient,
              level: "warning" as const,
              message: `${b.id} entered WARNING zone (${b.percent.toFixed(0)}%).`,
              at: new Date(),
            },
            ...l,
          ].slice(0, 50));
        }
        prevStatusRef.current[b.id] = b.status;
      }
    });
  }, [enriched]);

  // active banner = first critical not dismissed and not muted
  const bannerBed = criticalBeds.find(
    (b) => !dismissedBanner.has(b.id) && !b.muted
  );

  // chime when any unmuted critical exists
  const chimeActive = criticalBeds.some((b) => !b.muted) && !!bannerBed;
  useChime(chimeActive);

  // haptic vibration for critical alerts (with visual pulse fallback for unsupported devices)
  useEffect(() => {
    if (!chimeActive || !vibrationOn) {
      setHapticPulse(false);
      return;
    }
    const pattern = [220, 120, 220, 120, 320];
    const canVibrate =
      typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
    const buzz = () => {
      if (canVibrate) {
        try {
          navigator.vibrate(pattern);
        } catch {
          /* some browsers throw without user activation */
        }
      }
      // visual pulse always fires so unsupported devices still get feedback
      setHapticPulse(true);
      window.setTimeout(() => setHapticPulse(false), 900);
    };
    buzz();
    const t = window.setInterval(buzz, 2200);
    // re-prime when tab becomes visible again (Chrome pauses timers)
    const onVis = () => {
      if (document.visibilityState === "visible") buzz();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      if (canVibrate) {
        try {
          navigator.vibrate(0);
        } catch {
          /* noop */
        }
      }
      setHapticPulse(false);
    };
  }, [chimeActive, vibrationOn]);

  // load patients from cloud
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("*")
        .order("admitted_at", { ascending: false });
      if (!active) return;
      if (error) {
        toast.error("Failed to load patients", { description: error.message });
      } else if (data) {
        setPatients(data.map((r) => rowToPatient(r as DbPatient)));
      }
      setPatientsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const addPatient = async (p: Omit<PatientRecord, "id" | "admittedAt">) => {
    const { data, error } = await supabase
      .from("patients")
      .insert({
        name: p.name,
        age: p.age,
        sex: p.sex,
        ward: p.ward,
        bed_id: p.bedId,
        diagnosis: p.diagnosis,
        fluid_type: p.fluidType,
      })
      .select()
      .single();
    if (error) {
      toast.error("Could not save patient", { description: error.message });
      return;
    }
    if (data) {
      setPatients((prev) => [rowToPatient(data as DbPatient), ...prev]);
      toast.success("Patient admitted", { description: `${p.name} · ${p.bedId}` });
    }
  };

  const removePatient = async (id: string) => {
    const prev = patients;
    setPatients((cur) => cur.filter((x) => x.id !== id));
    const { error } = await supabase.from("patients").delete().eq("id", id);
    if (error) {
      setPatients(prev);
      toast.error("Could not discharge", { description: error.message });
    } else {
      toast.success("Patient discharged");
    }
  };


  // actions
  const toggleMute = (id: string) =>
    setBeds((prev) => prev.map((b) => (b.id === id ? { ...b, muted: !b.muted } : b)));

  const markRefilled = (id: string) => {
    setBeds((prev) =>
      prev.map((b) => (b.id === id ? { ...b, muted: false, ackCritical: true } : b))
    );
    setDismissedBanner((s) => new Set(s).add(id));
    toast("Refill acknowledged", {
      description: "Level will update from the IV pole sensor on the next reading.",
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Visual haptic pulse — fires alongside (or in place of) device vibration */}
      {vibrationOn && chimeActive && (
        <div
          aria-hidden
          className={`pointer-events-none fixed inset-0 z-[60] ring-inset ring-critical transition-[box-shadow,opacity] duration-200 ${
            hapticPulse
              ? "opacity-100 shadow-[inset_0_0_0_6px_var(--color-critical,#ef4444)]"
              : "opacity-40 shadow-[inset_0_0_0_2px_var(--color-critical,#ef4444)]"
          }`}
        />
      )}
      {/* Critical alert banner */}

      {bannerBed && (
        <div className="sticky top-0 z-40 animate-slide-down">
          <div className="bg-critical text-critical-foreground shadow-lg">
            <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 animate-critical-flash">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold sm:text-base">
                  CRITICAL ALERT: {bannerBed.id} ({bannerBed.patient}) requires immediate IV fluid bag replacement!
                </p>
                <p className="truncate text-xs text-white/85">
                  Remaining: {bannerBed.currentMl.toFixed(0)} ml · {bannerBed.percent.toFixed(0)}% · {bannerBed.ward}
                </p>
              </div>
              <button
                onClick={() => markRefilled(bannerBed.id)}
                className="hidden rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25 sm:inline-flex"
              >
                Mark Refilled
              </button>
              <button
                onClick={() => toggleMute(bannerBed.id)}
                className="rounded-md bg-white/15 p-2 hover:bg-white/25"
                aria-label="Mute alarm"
              >
                <BellOff className="h-4 w-4" />
              </button>
              <button
                onClick={() =>
                  setDismissedBanner((s) => new Set(s).add(bannerBed.id))
                }
                className="rounded-md bg-white/15 p-2 hover:bg-white/25"
                aria-label="Dismiss banner"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top nav */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6 lg:flex lg:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Droplets className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  LUTH · Smart IV Monitoring System
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  Centralized Nursing Station · Ward 3
                </p>
              </div>
            </div>
            <div className="hidden h-8 w-px bg-border md:block" />
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1.5 md:flex">
                <span className="relative grid h-2.5 w-2.5 place-items-center">
                  <span
                    className={`absolute inset-0 rounded-full ${
                      liveOffline ? "bg-critical" : "bg-stable animate-pulse-dot"
                    }`}
                  />
                </span>
                <span className="text-xs font-medium text-foreground">
                  {liveOffline ? "IV Pole Offline" : "IV Pole Online"}
                </span>
                {liveState.recordedAt && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    · {Math.max(0, Math.round((now.getTime() - liveState.recordedAt.getTime()) / 1000))}s ago
                  </span>
                )}
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium tabular-nums lg:flex">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{now.toLocaleTimeString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => {
                const next = !vibrationOn;
                setVibrationOn(next);
                // Prime the Vibration API inside the user gesture so browsers
                // that require recent user activation allow subsequent buzzes.
                let primed = false;
                if (next && vibrationSupported) {
                  try {
                    primed = navigator.vibrate([80, 40, 80]);
                  } catch {
                    primed = false;
                  }
                }
                if (!next) {
                  toast("Haptic vibration muted", {
                    description: "Vibration alerts silenced.",
                  });
                } else if (!vibrationSupported) {
                  toast("Haptic vibration unavailable", {
                    description:
                      "This device/browser doesn't support the Vibration API (iOS Safari & most desktops). A visual pulse + audio chime will fire on critical alerts instead.",
                  });
                } else if (!primed) {
                  toast("Haptic vibration enabled", {
                    description:
                      "Buzz test was blocked — tap again after any interaction to confirm your device vibrates.",
                  });
                } else {
                  toast("Haptic vibration enabled", {
                    description: "Device will buzz on critical alerts.",
                  });
                }
              }}
              className={`inline-flex items-center justify-center rounded-md border p-2 ${
                vibrationOn
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface hover:bg-secondary"
              }`}
              aria-label="Toggle vibration"
              aria-pressed={vibrationOn}
              title={
                !vibrationSupported
                  ? "Vibration API not supported on this device — visual pulse fallback active"
                  : vibrationOn
                    ? "Disable haptic vibration"
                    : "Enable haptic vibration"
              }
            >
              {vibrationOn ? <Vibrate className="h-4 w-4" /> : <VibrateOff className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface p-2 hover:bg-secondary"
              aria-label="Toggle theme"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              onClick={() => setShowLogs(true)}
              className="relative inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-secondary"
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Alert Logs</span>
              {logs.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                  {logs.length}
                </span>
              )}
            </button>
            <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-1.5 sm:flex">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-stable-soft text-foreground">
                <User2 className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <p className="text-xs font-semibold">On-Duty</p>
                <p className="text-[11px] text-muted-foreground">Ward 3 Admin</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-1 px-4 sm:px-6">
          <TabButton active={tab === "monitoring"} onClick={() => setTab("monitoring")} icon={<Activity className="h-3.5 w-3.5" />}>
            Live Monitoring
          </TabButton>
          <TabButton active={tab === "patients"} onClick={() => setTab("patients")} icon={<Users className="h-3.5 w-3.5" />}>
            Patient Records
            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
              {patients.length}
            </span>
          </TabButton>
        </div>
      </header>

      {tab === "monitoring" ? (
        <MonitoringView
          enriched={enriched}
          criticalBeds={criticalBeds}
          stableCount={stableCount}
          avgRefill={avgRefill}
          liveMode
          online={liveFresh}
          waitingForTelemetry={liveState.recordedAt === null}
          onMute={toggleMute}
          onRefill={markRefilled}
          onOpen={(id) => setOpenBedId(id)}
        />
      ) : (
        <PatientsView
          patients={patients}
          beds={beds}
          loading={patientsLoading}
          onAdd={addPatient}
          onRemove={removePatient}
        />
      )}
      {/* Alert logs drawer */}
      {showLogs && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-foreground/40" onClick={() => setShowLogs(false)} />
          <aside className="flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">Alert Logs History</h3>
                <p className="text-[11px] text-muted-foreground">Most recent {logs.length} events</p>
              </div>
              <button
                onClick={() => setShowLogs(false)}
                className="rounded-md p-2 hover:bg-secondary"
                aria-label="Close logs"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
                  No alerts recorded yet.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {logs.map((log) => (
                    <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                      <StatusDot status={log.level} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">{log.message}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {log.at.toLocaleTimeString()} · {log.bedId} · {log.patient}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Bed detail modal */}
      {openBed && (
        <BedDetailModal
          bed={openBed}
          onClose={() => setOpenBedId(null)}
        />
      )}
    </div>
  );
}

// ---------- KPI Card ----------

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "default" | "stable" | "warning" | "critical";
}) {
  const toneClasses =
    tone === "critical"
      ? "border-critical/40 bg-critical-soft"
      : tone === "warning"
        ? "border-warning/40 bg-warning-soft"
        : tone === "stable"
          ? "border-stable/30 bg-stable-soft/40"
          : "border-border bg-surface";
  const iconBg =
    tone === "critical"
      ? "bg-critical text-critical-foreground"
      : tone === "warning"
        ? "bg-warning text-warning-foreground"
        : tone === "stable"
          ? "bg-stable text-stable-foreground"
          : "bg-secondary text-foreground";
  return (
    <div className={`rounded-xl border ${toneClasses} p-4 transition-colors`}>
      <div className="flex items-center gap-2">
        <div className={`grid h-7 w-7 place-items-center rounded-md ${iconBg}`}>{icon}</div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground sm:text-3xl">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

// ---------- Bed Card ----------

function BedCard({
  bed,
  liveMode,
  onMute,
  onRefill,
  onOpen,
}: {
  bed: EnrichedBed;
  liveMode: boolean;
  onMute: () => void;
  onRefill: () => void;
  onOpen: () => void;
}) {
  const { status, percent } = bed;
  const ring =
    status === "critical"
      ? "border-critical ring-2 ring-critical/30 animate-critical-pulse"
      : status === "warning"
        ? "border-warning/60 shadow-[0_0_0_4px_color-mix(in_oklab,var(--warning)_15%,transparent)]"
        : "border-border";
  const barColor =
    !bed.telemetryAvailable
      ? "bg-muted-foreground/30"
      : status === "critical"
      ? "bg-critical"
      : status === "warning"
        ? "bg-warning"
        : "bg-stable";

  return (
    <article
      className={`group relative flex flex-col gap-3 rounded-xl border bg-surface p-4 transition ${ring}`}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold tracking-tight">{bed.id}</h3>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {bed.ward}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-foreground">{bed.patient}</p>
          <p className="truncate text-[11px] text-muted-foreground">{bed.fluidType}</p>
        </div>
        <StatusBadge status={status} muted={bed.muted} waiting={!bed.telemetryAvailable} />
      </header>

      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
        {/* IV bag visual */}
        <button
          onClick={onOpen}
          className="relative overflow-hidden rounded-md border border-border bg-surface-elevated transition hover:border-ring"
          aria-label={`Open ${bed.id} details`}
        >
          {/* bag top */}
          <div className="mx-auto mt-1 h-2 w-6 rounded-t-sm bg-muted" />
          <div className="relative mx-2 mb-2 h-[120px] rounded-md border border-border bg-white">
            <div
              className={`absolute bottom-0 left-0 right-0 ${barColor} transition-all duration-700 ${status === "critical" ? "animate-critical-flash" : ""}`}
              style={{ height: `${bed.telemetryAvailable ? percent : 0}%` }}
            >
              {bed.telemetryAvailable && (
                <div className="absolute -top-1 left-0 right-0 h-2 animate-liquid-wave opacity-60">
                  <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-full w-[120%]">
                    <path d="M0 5 Q 25 0 50 5 T 100 5 V 10 H 0 Z" fill="currentColor" className="text-white/40" />
                  </svg>
                </div>
              )}
            </div>
            {/* tick marks */}
            <div className="pointer-events-none absolute inset-y-1 right-0.5 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="block h-px w-1.5 bg-border" />
              ))}
            </div>
          </div>
          <p className="pb-1.5 text-center text-[10px] font-semibold tabular-nums text-foreground">
            {percent.toFixed(liveMode ? 2 : 0)}%
          </p>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Current Vol"
            value={`${bed.currentMl.toFixed(liveMode ? 1 : 0)} ml`}
            sub={`of ${bed.totalMl} ml`}
            icon={<Droplet className="h-3 w-3" />}
          />
          <Metric
            label="Flow Rate"
            value={`${bed.flowRate}`}
            sub="gtts/min"
            icon={<Activity className="h-3 w-3" />}
          />
          <Metric
            label="Time Remaining"
            value={
              bed.telemetryAvailable
                ? timeRemaining(bed.currentMl, bed.flowRate)
                : "0 min"
            }
            sub="@ current rate"
            icon={<Clock className="h-3 w-3" />}
            span2
            tone={status}
          />
        </div>
      </div>

      {status === "critical" && (
        <div className="flex items-center justify-center gap-2 rounded-md bg-critical px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-critical-foreground animate-critical-flash">
          <AlertTriangle className="h-3.5 w-3.5" /> Refill Immediate
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onMute}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition ${
            bed.muted
              ? "border-warning/50 bg-warning-soft text-foreground"
              : "border-border bg-surface hover:bg-secondary"
          }`}
        >
          {bed.muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          {bed.muted ? "Alarm Muted" : "Mute Alarm"}
        </button>
        <button
          onClick={onRefill}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Refilled
        </button>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  sub,
  icon,
  span2,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  span2?: boolean;
  tone?: Status;
}) {
  const accent =
    tone === "critical"
      ? "border-critical/40 bg-critical-soft"
      : tone === "warning"
        ? "border-warning/40 bg-warning-soft"
        : "border-border bg-surface-elevated";
  return (
    <div className={`rounded-md border ${accent} px-2 py-1.5 ${span2 ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
      <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function StatusBadge({
  status,
  muted,
  waiting = false,
}: {
  status: Status;
  muted: boolean;
  waiting?: boolean;
}) {
  const map: Record<Status, { label: string; cls: string }> = {
    stable: { label: "Stable", cls: "bg-stable text-stable-foreground" },
    warning: { label: "Warning", cls: "bg-warning text-warning-foreground" },
    critical: { label: "Critical", cls: "bg-critical text-critical-foreground" },
  };
  const m = waiting
    ? { label: "Waiting", cls: "bg-secondary text-muted-foreground" }
    : map[status];
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.cls}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
        {m.label}
      </span>
      {muted && (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <BellOff className="h-2.5 w-2.5" /> Muted
        </span>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === "critical"
      ? "bg-critical"
      : status === "warning"
        ? "bg-warning"
        : "bg-stable";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

// ---------- Bed Detail Modal ----------

function BedDetailModal({
  bed,
  onClose,
}: {
  bed: EnrichedBed;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {bed.ward} · {bed.fluidType}
            </p>
            <h3 className="truncate text-lg font-bold">
              {bed.id} · {bed.patient}
            </h3>
          </div>
          <button onClick={onClose} className="rounded-md p-2 hover:bg-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-4">
          <MiniStat label="Remaining" value={`${bed.currentMl.toFixed(0)} ml`} />
          <MiniStat label="Capacity" value={`${bed.totalMl} ml`} />
          <MiniStat label="Flow Rate" value={`${bed.flowRate} gtts/min`} />
          <MiniStat label="ETA Empty" value={bed.telemetryAvailable ? timeRemaining(bed.currentMl, bed.flowRate) : "0 min"} />
        </div>

        <div className="px-5 pb-5 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Historical telemetry
          </p>
          <div className="grid h-64 w-full place-items-center rounded-md border border-border bg-surface-elevated text-sm text-muted-foreground">
            Historical readings are not available.
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

// ---------- Tab Button ----------

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Monitoring View ----------

function MonitoringView({
  enriched,
  criticalBeds,
  stableCount,
  avgRefill,
  liveMode,
  online,
  waitingForTelemetry,
  onMute,
  onRefill,
  onOpen,
}: {
  enriched: EnrichedBed[];
  criticalBeds: EnrichedBed[];
  stableCount: number;
  avgRefill: number | null;
  liveMode: boolean;
  online: boolean;
  waitingForTelemetry: boolean;
  onMute: (id: string) => void;
  onRefill: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-5 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Connected Devices"
            value={String(online ? enriched.length : 0)}
            sub={
              online
                ? "1 IV pole online"
                : waitingForTelemetry
                  ? "Waiting for telemetry"
                  : "IV pole offline"
            }
            tone="default"
          />
          <KpiCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Critical Replacements"
            value={String(criticalBeds.length)}
            sub={criticalBeds.length > 0 ? `${criticalBeds.map((b) => b.id.split(" ")[1]).join(", ")} need refill` : "All clear"}
            tone={criticalBeds.length > 0 ? "critical" : "default"}
          />
          <KpiCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Stable Patients"
            value={String(stableCount)}
            sub="Fluid level above 30%"
            tone="stable"
          />
          <KpiCard
            icon={<Gauge className="h-4 w-4" />}
            label="Avg. Time to Refill"
            value={avgRefill === null ? "0 min" : `${avgRefill} min`}
            sub="Across all active beds"
            tone="default"
          />
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Patient Bed Monitoring
          </h2>
          <p className="text-[11px] text-muted-foreground">Click the card for fluid consumption history</p>
        </div>
        <div className="mx-auto grid max-w-xl grid-cols-1 gap-4">
          {enriched.map((b) => (
            <BedCard
              key={b.id}
              bed={b}
              liveMode={liveMode}
              onMute={() => onMute(b.id)}
              onRefill={() => onRefill(b.id)}
              onOpen={() => onOpen(b.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- Patients View ----------

const FLUID_OPTIONS = ["0.9% Normal Saline", "5% Dextrose", "Ringer's Lactate", "Dextrose Saline", "Plasma-Lyte"];
const WARD_OPTIONS = ["Ward 3 · A", "Ward 3 · B", "Ward 3 · C"];

function PatientsView({
  patients,
  beds,
  loading,
  onAdd,
  onRemove,
}: {
  patients: PatientRecord[];
  beds: Bed[];
  loading?: boolean;
  onAdd: (p: Omit<PatientRecord, "id" | "admittedAt">) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [ward, setWard] = useState(WARD_OPTIONS[0]);
  const [bedId, setBedId] = useState(beds[0]?.id ?? "");
  const [diagnosis, setDiagnosis] = useState("");
  const [fluidType, setFluidType] = useState(FLUID_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !age) return;
    setSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        age: Number(age),
        sex,
        ward,
        bedId,
        diagnosis: diagnosis.trim() || "—",
        fluidType,
      });
      setName("");
      setAge("");
      setDiagnosis("");
    } finally {
      setSaving(false);
    }
  };


  const inputCls =
    "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <form onSubmit={submit} className="rounded-xl border border-border bg-surface p-4 h-fit">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Admit New Patient</h3>
              <p className="text-[11px] text-muted-foreground">Register intake for IV monitoring</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Full Name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Okafor M." required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Age</label>
                <input className={inputCls} type="number" min="0" max="120" value={age} onChange={(e) => setAge(e.target.value)} placeholder="42" required />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sex</label>
                <select className={inputCls} value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ward</label>
                <select className={inputCls} value={ward} onChange={(e) => setWard(e.target.value)}>
                  {WARD_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bed</label>
                <select className={inputCls} value={bedId} onChange={(e) => setBedId(e.target.value)}>
                  {beds.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Diagnosis</label>
              <input className={inputCls} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Post-op rehydration" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">IV Fluid Type</label>
              <select className={inputCls} value={fluidType} onChange={(e) => setFluidType(e.target.value)}>
                {FLUID_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Register Patient"}
            </button>

          </div>
        </form>

        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-bold">Admitted Patients</h3>
              <p className="text-[11px] text-muted-foreground">{patients.length} active record{patients.length === 1 ? "" : "s"}</p>
            </div>
            <span className="rounded-full bg-stable-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
              Live
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-elevated text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">Patient</th>
                  <th className="px-4 py-2.5">Age/Sex</th>
                  <th className="px-4 py-2.5">Bed</th>
                  <th className="px-4 py-2.5">Diagnosis</th>
                  <th className="px-4 py-2.5">IV Fluid</th>
                  <th className="px-4 py-2.5">Admitted</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Loading patient records from cloud…
                    </td>
                  </tr>
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No patient records yet. Use the form to admit a patient.
                    </td>
                  </tr>
                ) : patients.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-elevated">

                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{p.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 font-semibold">{p.name}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.age} · {p.sex}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium">{p.bedId}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.diagnosis}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.fluidType}</td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums">
                      {p.admittedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onRemove(p.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-critical-soft hover:text-foreground"
                        aria-label={`Remove ${p.name}`}
                      >
                        <Trash2 className="h-3 w-3" /> Discharge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
