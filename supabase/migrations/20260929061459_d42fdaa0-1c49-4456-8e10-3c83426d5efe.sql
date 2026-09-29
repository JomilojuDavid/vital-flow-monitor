CREATE TABLE public.device_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bed_id TEXT NOT NULL,
  device_id TEXT,
  volume_ml NUMERIC NOT NULL,
  total_ml NUMERIC NOT NULL,
  flow_rate NUMERIC NOT NULL DEFAULT 0,
  flow_blocked BOOLEAN NOT NULL DEFAULT false,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX device_readings_bed_recorded_idx ON public.device_readings (bed_id, recorded_at DESC);

GRANT SELECT ON public.device_readings TO anon, authenticated;
GRANT ALL ON public.device_readings TO service_role;

ALTER TABLE public.device_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read device readings" ON public.device_readings FOR SELECT USING (true);