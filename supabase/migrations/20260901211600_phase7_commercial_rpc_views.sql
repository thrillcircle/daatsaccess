-- Phase 7 client-safe read helpers for refunds and privacy/commercial administration.

CREATE OR REPLACE FUNCTION public.list_ride_refunds(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_ride public.rides%ROWTYPE; v jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id=p_ride_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF v_ride.passenger_id<>v_actor AND NOT private.has_role(v_actor,'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    to_jsonb(r) || jsonb_build_object(
      'payment_amount',p.amount,
      'payment_purpose',p.purpose,
      'merchant_payment_id',p.merchant_payment_id,
      'provider_payment_id',p.provider_payment_id
    ) ORDER BY r.created_at DESC
  ),'[]'::jsonb)
  INTO v
  FROM public.payment_refunds r
  JOIN public.payments p ON p.id=r.payment_id
  WHERE p.ride_id=p_ride_id;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_ride_refunds(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_ride_refunds(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_payment_refunds(p_limit integer DEFAULT 250)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(
    to_jsonb(r) || jsonb_build_object(
      'ride_id',p.ride_id,
      'passenger_id',p.passenger_id,
      'payment_amount',p.amount,
      'merchant_payment_id',p.merchant_payment_id,
      'provider_payment_id',p.provider_payment_id,
      'passenger_name',profile.full_name
    ) ORDER BY r.created_at DESC
  ),'[]'::jsonb)
  INTO v
  FROM (
    SELECT * FROM public.payment_refunds ORDER BY created_at DESC
    LIMIT LEAST(GREATEST(p_limit,1),1000)
  ) r
  JOIN public.payments p ON p.id=r.payment_id
  LEFT JOIN public.profiles profile ON profile.user_id=p.passenger_id;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_payment_refunds(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_refunds(integer) TO authenticated;

NOTIFY pgrst,'reload schema';
