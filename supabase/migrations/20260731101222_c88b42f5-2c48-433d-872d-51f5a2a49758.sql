-- Phase 4 quote privacy boundary.
-- Quote tables contain internal margin, snapshots and audit data, so clients read
-- through ownership/role-checked RPCs instead of direct table SELECT grants.

CREATE OR REPLACE FUNCTION public.admin_quote_workspace(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.pricing_require_admin();
  v_booking public.service_bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.service_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service booking not found'; END IF;
  RETURN jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'quotes', (
      SELECT COALESCE(jsonb_agg(to_jsonb(quote) ORDER BY quote.revision_number DESC), '[]'::jsonb)
      FROM public.service_quotes quote WHERE quote.booking_id = p_booking_id
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.calculation_order, item.id), '[]'::jsonb)
      FROM public.service_quote_items item
      JOIN public.service_quotes quote ON quote.id = item.quote_id
      WHERE quote.booking_id = p_booking_id
    ),
    'audit_events', (
      SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.created_at DESC), '[]'::jsonb)
      FROM public.quote_audit_events event WHERE event.booking_id = p_booking_id
    ),
    'actor_id', v_actor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_quote_summaries(p_booking_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM public.pricing_require_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', quote.id,
      'booking_id', quote.booking_id,
      'quote_reference', quote.quote_reference,
      'status', quote.status::text,
      'revision_number', quote.revision_number,
      'currency', quote.currency,
      'subtotal', quote.subtotal,
      'adjustments_total', quote.adjustments_total,
      'final_total', quote.final_total,
      'valid_until', quote.valid_until,
      'sent_at', quote.sent_at,
      'accepted_at', quote.accepted_at,
      'declined_at', quote.declined_at,
      'expired_at', quote.expired_at,
      'superseded_at', quote.superseded_at,
      'row_version', quote.row_version
    ) ORDER BY quote.created_at DESC)
    FROM public.service_quotes quote
    WHERE p_booking_ids IS NULL OR quote.booking_id = ANY(p_booking_ids)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_quote_workspace(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_booking public.service_bookings%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_booking
  FROM public.service_bookings
  WHERE id = p_booking_id AND booked_by_user_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found for this passenger'; END IF;

  RETURN jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'booking_reference', v_booking.booking_reference,
      'service_type', v_booking.service_type::text,
      'status', v_booking.status::text,
      'start_at', v_booking.start_at,
      'quoted_total', v_booking.quoted_total,
      'deposit_amount', v_booking.deposit_amount,
      'deposit_status', v_booking.deposit_status::text
    ),
    'quotes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', quote.id,
        'booking_id', quote.booking_id,
        'quote_reference', quote.quote_reference,
        'status', quote.status::text,
        'revision_number', quote.revision_number,
        'currency', quote.currency,
        'subtotal', quote.subtotal,
        'adjustments_total', quote.adjustments_total,
        'final_total', quote.final_total,
        'deposit_required', quote.deposit_required,
        'deposit_amount', quote.deposit_amount_snapshot,
        'valid_until', quote.valid_until,
        'sent_at', quote.sent_at,
        'accepted_at', quote.accepted_at,
        'declined_at', quote.declined_at,
        'expired_at', quote.expired_at,
        'superseded_at', quote.superseded_at,
        'cancelled_at', quote.cancelled_at,
        'row_version', quote.row_version,
        'created_at', quote.created_at
      ) ORDER BY quote.revision_number DESC), '[]'::jsonb)
      FROM public.service_quotes quote WHERE quote.booking_id = p_booking_id
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', item.id,
        'quote_id', item.quote_id,
        'component_code', item.component_code,
        'label', item.label,
        'description', item.description,
        'quantity', item.quantity,
        'unit', item.unit,
        'unit_price', item.unit_price,
        'line_subtotal', item.line_subtotal,
        'adjustment', item.adjustment,
        'line_total', item.line_total,
        'calculation_order', item.calculation_order
      ) ORDER BY item.calculation_order, item.id), '[]'::jsonb)
      FROM public.service_quote_items item
      JOIN public.service_quotes quote ON quote.id = item.quote_id
      WHERE quote.booking_id = p_booking_id AND item.customer_visible
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_quote_summaries()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', quote.id,
      'booking_id', quote.booking_id,
      'quote_reference', quote.quote_reference,
      'status', quote.status::text,
      'revision_number', quote.revision_number,
      'currency', quote.currency,
      'final_total', quote.final_total,
      'valid_until', quote.valid_until,
      'sent_at', quote.sent_at,
      'accepted_at', quote.accepted_at,
      'declined_at', quote.declined_at,
      'expired_at', quote.expired_at,
      'superseded_at', quote.superseded_at,
      'row_version', quote.row_version
    ) ORDER BY quote.created_at DESC)
    FROM public.service_quotes quote
    JOIN public.service_bookings booking ON booking.id = quote.booking_id
    WHERE booking.booked_by_user_id = v_actor
  ), '[]'::jsonb);
END;
$$;

REVOKE SELECT ON public.service_quotes, public.service_quote_items FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_quote_workspace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_quote_summaries(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_quote_workspace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.passenger_quote_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_quote_workspace(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_quote_summaries(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_quote_workspace(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_quote_summaries() TO authenticated, service_role;