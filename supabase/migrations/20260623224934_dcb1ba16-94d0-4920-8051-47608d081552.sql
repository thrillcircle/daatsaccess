DROP FUNCTION IF EXISTS public.driver_avg_rating(uuid);

CREATE OR REPLACE FUNCTION private.driver_avg_rating(driver_user_id uuid)
RETURNS TABLE (avg numeric, count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg,
    COUNT(*)::int AS count
  FROM public.ride_ratings
  WHERE driver_id = driver_user_id;
$$;

REVOKE EXECUTE ON FUNCTION private.driver_avg_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.driver_avg_rating(uuid) TO service_role;