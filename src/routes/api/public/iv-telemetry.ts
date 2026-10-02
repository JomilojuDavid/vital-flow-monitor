import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ReadingSchema = z.object({
  bed_id: z.string().min(1).max(32),
  device_id: z.string().min(1).max(64).optional(),
  volume_ml: z.number().min(0).max(10000),
  total_ml: z.number().min(1).max(10000),
  flow_rate_gtt_per_min: z.number().min(0).max(500).optional(),
  flow_blocked: z.boolean().optional(),
  timestamp: z.string().datetime().optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/iv-telemetry")({
  server: {
    handlers: {
      // Latest reading per bed, for the dashboard / quick device check.
      GET: async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
        const key =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) return json({ error: "Backend not configured" }, 500);
        const supabasePublic = createClient(url, key, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await supabasePublic
          .from("device_readings")
          .select("bed_id, volume_ml, total_ml, flow_rate, flow_blocked, recorded_at")
          .order("recorded_at", { ascending: false })
          .limit(50);

        if (error) return json({ error: "Unable to read telemetry" }, 500);

        const latest = new Map<string, (typeof data)[number]>();
        for (const row of data ?? []) {
          if (!latest.has(row.bed_id)) latest.set(row.bed_id, row);
        }
        return json({ readings: Array.from(latest.values()) });
      },

      // ESP32 posts sensor readings here.
      POST: async ({ request }) => {
        const deviceKey = process.env["IV_DEVICE_KEY"];
        if (!deviceKey) return json({ error: "Device key not configured" }, 503);

        const provided =
          request.headers.get("x-device-key") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";

        if (provided.length !== deviceKey.length || provided !== deviceKey) {
          return json({ error: "Unauthorized device" }, 401);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = ReadingSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid payload", issues: parsed.error.issues }, 400);
        }
        const r = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("device_readings").insert({
          bed_id: r.bed_id,
          device_id: r.device_id ?? null,
          volume_ml: Math.min(r.volume_ml, r.total_ml),
          total_ml: r.total_ml,
          flow_rate: r.flow_rate_gtt_per_min ?? 0,
          flow_blocked: r.flow_blocked ?? false,
          recorded_at: r.timestamp ?? new Date().toISOString(),
        });

        if (error) return json({ error: "Unable to store reading" }, 500);
        return json({ ok: true });
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-device-key, authorization",
          },
        }),
    },
  },
});
