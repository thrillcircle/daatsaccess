-- Phase 1 foundation for Admin > Pricing & Services.
-- Normal Ride and Access Transport preserve the confirmed R20 + R13.50/km formula.
-- Specialised-service values are seeded as editable mock data and must be reviewed before launch.

CREATE TABLE IF NOT EXISTS public.service_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL UNIQUE CHECK (service_type IN ('ride','transport','assisted','appointment','extended_journey')),
  currency text NOT NULL DEFAULT 'ZAR',
  base_fare numeric(10,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  per_km_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_km_rate >= 0),
  per_minute_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_minute_rate >= 0),
  companion_hourly_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_hourly_rate >= 0),
  companion_minimum_hours numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_minimum_hours >= 0),
  waiting_hourly_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (waiting_hourly_rate >= 0),
  specialist_vehicle_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (specialist_vehicle_fee >= 0),
  vehicle_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (vehicle_daily_rate >= 0),
  driver_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (driver_daily_rate >= 0),
  driver_overnight_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (driver_overnight_rate >= 0),
  companion_daily_rate numeric(10,2) NOT NULL DEFAULT 0 CHECK (companion_daily_rate >= 0),
  platform_margin_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (platform_margin_percent >= 0 AND platform_margin_percent < 100),
  is_active boolean NOT NULL DEFAULT true,
  is_mock boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_pricing_rules TO authenticated;
GRANT ALL ON public.service_pricing_rules TO service_role;
ALTER TABLE public.service_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can view service pricing"
  ON public.service_pricing_rules FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can insert service pricing"
  ON public.service_pricing_rules FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can update service pricing"
  ON public.service_pricing_rules FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete service pricing" ON public.service_pricing_rules;
CREATE POLICY "Admins can delete service pricing"
  ON public.service_pricing_rules FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS set_service_pricing_rules_updated_at ON public.service_pricing_rules;
CREATE TRIGGER set_service_pricing_rules_updated_at
  BEFORE UPDATE ON public.service_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.service_pricing_rules (
  service_type, base_fare, per_km_rate, per_minute_rate,
  companion_hourly_rate, companion_minimum_hours, waiting_hourly_rate,
  specialist_vehicle_fee, vehicle_daily_rate, driver_daily_rate,
  driver_overnight_rate, companion_daily_rate, platform_margin_percent,
  is_active, is_mock
) VALUES
  ('ride', 20.00, 13.50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, false),
  ('transport', 20.00, 13.50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, false),
  ('assisted', 20.00, 13.50, 0, 120.00, 2.00, 0, 150.00, 0, 0, 0, 0, 15.00, true, true),
  ('appointment', 20.00, 13.50, 0, 120.00, 2.00, 100.00, 150.00, 0, 0, 0, 0, 15.00, true, true),
  ('extended_journey', 20.00, 13.50, 0, 0, 0, 0, 250.00, 1200.00, 900.00, 450.00, 800.00, 15.00, true, true)
ON CONFLICT (service_type) DO NOTHING;

COMMENT ON TABLE public.service_pricing_rules IS
  'Admin-controlled, version-ready pricing foundation. Specialised-service seed values are mock data until reviewed.';
