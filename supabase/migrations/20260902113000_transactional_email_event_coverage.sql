-- Expand the existing Access transactional-email pipeline without turning fast-moving
-- driver location/status events into email noise.
--
-- Required transactional records: money/cancellation and paid booking submission.
-- Optional operational records (respect passenger Email preference): driver accepted,
-- significant passenger trip edit, trip completed, service quote and 24h reminder.
--
-- Some newer lifecycle notifications are written directly to public.notifications rather
-- than notification_outbox. Mirror only those selected records into an already-delivered
-- outbox item so the existing in-app message is not duplicated while external channels can
-- still be planned and delivered.

CREATE OR REPLACE FUNCTION private.plan_notification_channels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
  v_pref public.user_notification_preferences%ROWTYPE;
  v_global jsonb;
  v_providers jsonb;
  v_channel text;
  v_enabled boolean;
  v_email_provider_ready boolean := false;
  v_email_required boolean := false;
  v_email_optional boolean := false;
  v_recipient_is_passenger boolean := false;
BEGIN
  SELECT * INTO v_pref
  FROM public.user_notification_preferences
  WHERE user_id=NEW.recipient_user_id;

  SELECT value INTO v_global
  FROM public.app_settings
  WHERE key='notifications.preferences';

  SELECT value INTO v_providers
  FROM public.app_settings
  WHERE key='notifications.providers';

  v_email_provider_ready := COALESCE((v_providers->'email'->>'configured')::boolean,false);
  v_recipient_is_passenger := private.has_role(NEW.recipient_user_id,'passenger'::public.app_role);

  v_email_required := v_recipient_is_passenger AND NEW.notification_type IN (
    'payment_received',
    'payment_failed',
    'refund_queued',
    'refund_processed',
    'cancellation_balance_due',
    'ride_cancelled',
    'payment_confirmed_trip_submitted'
  );

  v_email_optional := v_recipient_is_passenger AND NEW.notification_type IN (
    'driver_accepted',
    'ride_edit_applied',
    'ride_completed',
    'service_quote_ready',
    'service_reminder_24h'
  );

  FOREACH v_channel IN ARRAY ARRAY['in_app','push','sms','whatsapp','email'] LOOP
    v_enabled := CASE v_channel
      WHEN 'in_app' THEN true
      WHEN 'push' THEN COALESCE(v_pref.push,true) AND COALESCE((v_global->>'push')::boolean,true)
      WHEN 'sms' THEN COALESCE(v_pref.sms,false) AND COALESCE((v_global->>'sms')::boolean,false)
      WHEN 'whatsapp' THEN COALESCE(v_pref.whatsapp,false) AND COALESCE((v_global->>'whatsapp')::boolean,false)
      WHEN 'email' THEN
        COALESCE((v_global->>'email')::boolean,true)
        AND (v_email_required OR (v_email_optional AND COALESCE(v_pref.email,true)))
      ELSE false
    END;

    INSERT INTO public.notification_channel_deliveries(
      notification_outbox_id,recipient_user_id,channel,status,provider,last_error,delivered_at
    ) VALUES (
      NEW.id,
      NEW.recipient_user_id,
      v_channel,
      CASE
        WHEN NOT v_enabled THEN 'skipped'
        WHEN v_channel='in_app' AND NEW.status='delivered' THEN 'delivered'
        WHEN v_channel='in_app' THEN 'queued'
        WHEN v_channel='email' AND v_email_provider_ready THEN 'queued'
        ELSE 'action_required'
      END,
      CASE
        WHEN v_channel='in_app' THEN 'access'
        WHEN v_channel='email' AND v_email_provider_ready THEN 'lovable_email'
        ELSE NULL
      END,
      CASE
        WHEN v_channel='email' AND v_enabled AND NOT v_email_provider_ready
          THEN 'Access transactional email provider is not enabled'
        WHEN v_channel NOT IN ('in_app','email') AND v_enabled
          THEN 'External provider is not configured for this channel'
        ELSE NULL
      END,
      CASE WHEN v_channel='in_app' AND NEW.status='delivered'
        THEN COALESCE(NEW.delivered_at,now()) ELSE NULL END
    ) ON CONFLICT(notification_outbox_id,channel) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.plan_notification_channels() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.mirror_passenger_transactional_notification_to_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
  IF NEW.type NOT IN (
    'payment_confirmed_trip_submitted',
    'driver_accepted',
    'ride_edit_applied',
    'ride_completed'
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT private.has_role(NEW.user_id,'passenger'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- If an authoritative outbox producer already queued the same event, do not create a
  -- second external delivery. This also keeps the hook future-compatible if a lifecycle
  -- producer is later migrated to operations_enqueue_notification().
  IF EXISTS (
    SELECT 1
    FROM public.notification_outbox o
    WHERE o.recipient_user_id=NEW.user_id
      AND o.notification_type=NEW.type
      AND o.ride_id IS NOT DISTINCT FROM NEW.ride_id
      AND o.service_booking_id IS NOT DISTINCT FROM NEW.service_booking_id
      AND o.title=NEW.title
      AND o.message IS NOT DISTINCT FROM NEW.body
      AND o.created_at BETWEEN NEW.created_at - interval '5 minutes'
                           AND NEW.created_at + interval '5 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_outbox(
    recipient_user_id,
    notification_type,
    title,
    message,
    ride_id,
    service_booking_id,
    scheduled_for,
    deduplication_key,
    status,
    delivered_at
  ) VALUES (
    NEW.user_id,
    NEW.type,
    NEW.title,
    NEW.body,
    NEW.ride_id,
    NEW.service_booking_id,
    NEW.created_at,
    'transactional-notification:' || NEW.id::text,
    'delivered',
    NEW.created_at
  )
  ON CONFLICT(deduplication_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.mirror_passenger_transactional_notification_to_outbox()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mirror_passenger_transactional_notification_to_outbox
ON public.notifications;
CREATE TRIGGER trg_mirror_passenger_transactional_notification_to_outbox
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION private.mirror_passenger_transactional_notification_to_outbox();

NOTIFY pgrst, 'reload schema';
