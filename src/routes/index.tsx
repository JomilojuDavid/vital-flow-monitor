import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BellOff,
  BellRing,
  Bell,
  CheckCircle2,
  Clock,
  Droplet,
  Droplets,
  Gauge,
  History,
  Moon,
  Pause,
  Play,
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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Area,
  AreaChart,
} from "recharts";
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

const INITIAL_BEDS: Bed[] = [
  { id: "BED 01", name: "BED 01", patient: "Adeyemi J.", ward: "Ward 3 · A", totalMl: 500, currentMl: 412, flowRate: 28, fluidType: "0.9% Normal Saline", muted: false, ackCritical: false },
  { id: "BED 02", name: "BED 02", patient: "Komolafe D.", ward: "Ward 3 · A", totalMl: 500, currentMl: 165, flowRate: 32, fluidType: "5% Dextrose", muted: false, ackCritical: false },
  { id: "BED 03", name: "BED 03", patient: "Ibrahim S.", ward: "Ward 3 · B", totalMl: 1000, currentMl: 740, flowRate: 24, fluidType: "Ringer's Lactate", muted: false, ackCritical: false },
  { id: "BED 04", name: "BED 04", patient: "Balogun K.", ward: "Ward 3 · B", totalMl: 500, currentMl: 380, flowRate: 30, fluidType: "0.9% Normal Saline", muted: false, ackCritical: false },
  { id: "BED 05", name: "BED 05", patient: "Eze C.", ward: "Ward 3 · C", totalMl: 500, currentMl: 78, flowRate: 36, fluidType: "5% Dextrose", muted: false, ackCritical: false },
  { id: "BED 06", name: "BED 06", patient: "Akpan U.", ward: "Ward 3 · C", totalMl: 1000, currentMl: 612, flowRate: 26, fluidType: "Ringer's Lactate", muted: false, ackCritical: false },
];

const SIMULATED_BED_IDS = ["BED 02", "BED 05"];

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
  const [simOn, setSimOn] = useState(true);
  const [simSpeed, setSimSpeed] = useState(2); // 1x, 2x, 5x
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("iv-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("iv-vibration", vibrationOn ? "on" : "off");
  }, [vibrationOn]);


  // clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // simulation tick
  useEffect(() => {
    if (!simOn) return;
    const t = window.setInterval(() => {
      setBeds((prev) =>
        prev.map((b) => {
          if (!SIMULATED_BED_IDS.includes(b.id)) return b;
          const mlPerMin = b.flowRate / 20;
          // accelerate so demo is observable: 1 tick ~ 1 simulated minute * simSpeed
          const drop = mlPerMin * simSpeed;
          const next = Math.max(0, b.currentMl - drop);
          return { ...b, currentMl: Number(next.toFixed(1)) };
        })
      );
    }, 1000);
    return () => window.clearInterval(t);
  }, [simOn, simSpeed]);

  // derived
  const enriched = useMemo(
    () =>
      beds.map((b) => {
        const percent = (b.currentMl / b.totalMl) * 100;
        return { ...b, percent, status: getStatus(percent) };
      }),
    [beds]
  );
  const openBed = openBedId ? enriched.find((b) => b.id === openBedId) ?? null : null;

  const criticalBeds = enriched.filter((b) => b.status === "critical");
  const stableCount = enriched.filter((b) => b.status === "stable").length;
  const avgRefill = useMemo(() => {
    // avg minutes till empty across all beds
    const mins = enriched.map((b) => {
      const mlPerMin = b.flowRate / 20;
      return mlPerMin > 0 ? b.currentMl / mlPerMin : 0;
    });
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

  // haptic vibration for critical alerts
  useEffect(() => {
    if (!chimeActive || !vibrationOn) return;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    // urgent triple-buzz pattern, repeats every 2.2s alongside chime
    const pattern = [220, 120, 220, 120, 320];
    navigator.vibrate(pattern);
    const t = window.setInterval(() => navigator.vibrate(pattern), 2200);
    return () => {
      window.clearInterval(t);
      navigator.vibrate(0);
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
      prev.map((b) =>
        b.id === id
          ? { ...b, currentMl: b.totalMl, muted: false, ackCritical: false }
          : b
      )
    );
    setDismissedBanner((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setLogs((l) => [
      {
        id: `${id}-refill-${Date.now()}`,
        bedId: id,
        patient: beds.find((b) => b.id === id)?.patient ?? "",
        level: "stable" as const,
        message: `${id} marked refilled — new bag installed.`,
        at: new Date(),
      },
      ...l,
    ].slice(0, 50));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <div className="hidden items-center gap-2 md:flex">
              <span className="relative grid h-2.5 w-2.5 place-items-center">
                <span className="absolute inset-0 rounded-full bg-stable animate-pulse-dot" />
              </span>
              <span className="text-xs font-medium text-foreground">System Online</span>
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
          onMute={toggleMute}
          onRefill={markRefilled}
          onOpen={(id) => setOpenBedId(id)}
        />
      ) : (
        <PatientsView
          patients={patients}
          beds={beds}
          onAdd={(p) =>
            setPatients((prev) => [
              { ...p, id: `P-${1000 + prev.length + 1}`, admittedAt: new Date() },
              ...prev,
            ])
          }
          onRemove={(id) => setPatients((prev) => prev.filter((p) => p.id !== id))}
        />
      )}


      {/* Simulation panel (floating) */}
      <SimulationPanel
        on={simOn}
        speed={simSpeed}
        onToggle={() => setSimOn((v) => !v)}
        onSpeed={(s) => setSimSpeed(s)}
      />

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
        <BedDetailModal bed={openBed} onClose={() => setOpenBedId(null)} />
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
  onMute,
  onRefill,
  onOpen,
}: {
  bed: Bed & { percent: number; status: Status };
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
    status === "critical"
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
        <StatusBadge status={status} muted={bed.muted} />
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
              style={{ height: `${percent}%` }}
            >
              <div className="absolute -top-1 left-0 right-0 h-2 animate-liquid-wave opacity-60">
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-full w-[120%]">
                  <path d="M0 5 Q 25 0 50 5 T 100 5 V 10 H 0 Z" fill="currentColor" className="text-white/40" />
                </svg>
              </div>
            </div>
            {/* tick marks */}
            <div className="pointer-events-none absolute inset-y-1 right-0.5 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="block h-px w-1.5 bg-border" />
              ))}
            </div>
          </div>
          <p className="pb-1.5 text-center text-[10px] font-semibold tabular-nums text-foreground">
            {percent.toFixed(0)}%
          </p>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Current Vol" value={`${bed.currentMl.toFixed(0)} ml`} sub={`of ${bed.totalMl} ml`} icon={<Droplet className="h-3 w-3" />} />
          <Metric label="Flow Rate" value={`${bed.flowRate}`} sub="gtts/min" icon={<Activity className="h-3 w-3" />} />
          <Metric
            label="Time Remaining"
            value={timeRemaining(bed.currentMl, bed.flowRate)}
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

function StatusBadge({ status, muted }: { status: Status; muted: boolean }) {
  const map: Record<Status, { label: string; cls: string }> = {
    stable: { label: "Stable", cls: "bg-stable text-stable-foreground" },
    warning: { label: "Warning", cls: "bg-warning text-warning-foreground" },
    critical: { label: "Critical", cls: "bg-critical text-critical-foreground" },
  };
  const m = map[status];
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

// ---------- Simulation Panel ----------

function SimulationPanel({
  on,
  speed,
  onToggle,
  onSpeed,
}: {
  on: boolean;
  speed: number;
  onToggle: () => void;
  onSpeed: (s: number) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="fixed bottom-4 right-4 z-30">
      {open ? (
        <div className="w-72 rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`relative grid h-2 w-2 place-items-center`}>
                <span className={`absolute inset-0 rounded-full ${on ? "bg-stable animate-pulse-dot" : "bg-muted-foreground"}`} />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wider">Simulation Panel</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-secondary" aria-label="Collapse">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3 p-3">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Demo mode degrades fluid in <span className="font-semibold text-foreground">Bed 02</span> and{" "}
              <span className="font-semibold text-foreground">Bed 05</span>. Watch the transition
              Green → Amber → <span className="text-critical font-semibold">Critical Red</span>.
            </p>
            <button
              onClick={onToggle}
              className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition ${
                on ? "bg-critical text-critical-foreground hover:opacity-90" : "bg-stable text-stable-foreground hover:opacity-90"
              }`}
            >
              {on ? <><Pause className="h-3.5 w-3.5" /> Pause Simulation</> : <><Play className="h-3.5 w-3.5" /> Start Simulation</>}
            </button>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Speed</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[1, 2, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => onSpeed(s)}
                    className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition ${
                      speed === s
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface hover:bg-secondary"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:opacity-90"
        >
          <BellRing className="h-4 w-4" /> Simulation
        </button>
      )}
    </div>
  );
}

// ---------- Bed Detail Modal ----------

function BedDetailModal({
  bed,
  onClose,
}: {
  bed: Bed & { percent: number; status: Status };
  onClose: () => void;
}) {
  // generate mock historical consumption: 30 mins, descending from a starting level toward current
  const data = useMemo(() => {
    const points: { t: string; volume: number }[] = [];
    const mlPerMin = bed.flowRate / 20;
    let v = bed.currentMl + mlPerMin * 30;
    v = Math.min(v, bed.totalMl);
    for (let i = 30; i >= 0; i--) {
      const jitter = (Math.random() - 0.5) * 4;
      const value = Math.max(0, Math.min(bed.totalMl, v + jitter));
      points.push({ t: `-${i}m`, volume: Number(value.toFixed(1)) });
      v -= mlPerMin;
    }
    points[points.length - 1].volume = bed.currentMl;
    return points;
  }, [bed]);

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
          <MiniStat label="ETA Empty" value={timeRemaining(bed.currentMl, bed.flowRate)} />
        </div>

        <div className="px-5 pb-5 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Fluid Consumption · Last 30 Minutes
          </p>
          <div className="h-64 w-full rounded-md border border-border bg-surface-elevated p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--stable)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--stable)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" unit="ml" />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="volume" stroke="var(--stable)" strokeWidth={2} fill="url(#g)" />
                <Line type="monotone" dataKey="volume" stroke="var(--stable)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
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
  onMute,
  onRefill,
  onOpen,
}: {
  enriched: (Bed & { percent: number; status: Status })[];
  criticalBeds: (Bed & { percent: number; status: Status })[];
  stableCount: number;
  avgRefill: number;
  onMute: (id: string) => void;
  onRefill: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <section className="mx-auto max-w-[1600px] px-4 pt-5 sm:px-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Total Active Beds"
            value={String(enriched.length)}
            sub="6 of 6 monitored"
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
            value={`${avgRefill} min`}
            sub="Across all active beds"
            tone="default"
          />
        </div>
      </section>

      <section className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Patient Bed Monitoring
          </h2>
          <p className="text-[11px] text-muted-foreground">Click any card for fluid consumption history</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {enriched.map((b) => (
            <BedCard
              key={b.id}
              bed={b}
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
  onAdd,
  onRemove,
}: {
  patients: PatientRecord[];
  beds: Bed[];
  onAdd: (p: Omit<PatientRecord, "id" | "admittedAt">) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [ward, setWard] = useState(WARD_OPTIONS[0]);
  const [bedId, setBedId] = useState(beds[0]?.id ?? "");
  const [diagnosis, setDiagnosis] = useState("");
  const [fluidType, setFluidType] = useState(FLUID_OPTIONS[0]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !age) return;
    onAdd({
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Register Patient
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
                {patients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No patient records yet. Use the form to admit a patient.
                    </td>
                  </tr>
                ) : patients.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-elevated">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{p.id}</td>
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
