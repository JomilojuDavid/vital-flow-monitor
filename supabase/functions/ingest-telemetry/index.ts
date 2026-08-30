import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-key",
};

Deno.serve(async (req) => {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  // --------------------------------------------------
  // POST ONLY
  // --------------------------------------------------

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // --------------------------------------------------
  // DEVICE AUTHENTICATION
  // --------------------------------------------------

  const deviceKey =
    req.headers.get("x-device-key");

  const expectedKey =
    Deno.env.get("ESP32_DEVICE_KEY");

  if (
    !deviceKey ||
    !expectedKey ||
    deviceKey !== expectedKey
  ) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized device",
      }),
      {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // --------------------------------------------------
  // READ REQUEST
  // --------------------------------------------------

  try {
    const body = await req.json();

    const {
      bed_id,
      volume_ml,
      total_ml,
      percentage,
      flow_rate_gtt_per_min,
      flow_blocked,
    } = body;

    // ------------------------------------------------
    // VALIDATION
    // ------------------------------------------------

    if (
      typeof bed_id !== "string" ||
      typeof volume_ml !== "number" ||
      typeof total_ml !== "number" ||
      typeof percentage !== "number"
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid telemetry payload",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ------------------------------------------------
    // STATUS CALCULATION
    //
    // Dashboard uses:
    //
    // <= 10% = critical
    // <= 30% = warning
    // > 30%  = stable
    //
    // ------------------------------------------------

    let status = "stable";

    if (
      percentage <= 10 ||
      flow_blocked === true
    ) {
      status = "critical";
    } else if (percentage <= 30) {
      status = "warning";
    }

    // ------------------------------------------------
    // SUPABASE CLIENT
    // ------------------------------------------------

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Missing Supabase environment variables",
      );
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );

    // ------------------------------------------------
    // UPDATE TELEMETRY
    // ------------------------------------------------

    const { data, error } =
      await supabase
        .from("iv_telemetry")
        .upsert(
          {
            bed_id,

            volume_ml,

            total_ml,

            percentage,

            flow_rate_gtt_per_min:
              typeof flow_rate_gtt_per_min ===
              "number"
                ? flow_rate_gtt_per_min
                : 0,

            flow_blocked:
              flow_blocked === true,

            device_online: true,

            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "bed_id",
          },
        )
        .select()
        .single();

    if (error) {
      throw error;
    }

    // ------------------------------------------------
    // RESPONSE
    // ------------------------------------------------

    return new Response(
      JSON.stringify({
        success: true,
        status,
        data,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      },
    );
  }
});
