CREATE TABLE public.patients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M','F')),
  ward TEXT NOT NULL,
  bed_id TEXT NOT NULL,
  diagnosis TEXT NOT NULL DEFAULT '—',
  fluid_type TEXT NOT NULL,
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO anon, authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read patients" ON public.patients FOR SELECT USING (true);
CREATE POLICY "Public insert patients" ON public.patients FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete patients" ON public.patients FOR DELETE USING (true);
CREATE POLICY "Public update patients" ON public.patients FOR UPDATE USING (true) WITH CHECK (true);