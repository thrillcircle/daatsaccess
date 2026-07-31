DROP POLICY IF EXISTS "Drivers read assigned incidents" ON public.operational_incidents;

CREATE OR REPLACE FUNCTION public.driver_operation_incidents(p_run_id uuid)
RETURNS TABLE (
  id uuid,
  operation_run_id uuid,
  incident_reference text,
  incident_type text,
  severity text,
  status text,
  title text,
  passenger_visible_summary text,
  resolved_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id,
         i.operation_run_id,
         i.incident_reference::text,
         i.incident_type::text,
         i.severity::text,
         i.status::text,
         i.title::text,
         i.passenger_visible_summary::text,
         i.resolved_at,
         i.created_at
  FROM public.operational_incidents i
  WHERE i.operation_run_id = p_run_id
    AND EXISTS (
      SELECT 1 FROM public.operation_run_assignments a
      WHERE a.operation_run_id = i.operation_run_id
        AND a.driver_user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.driver_operation_incidents(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_operation_incidents(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_operation_incidents(uuid) TO authenticated;