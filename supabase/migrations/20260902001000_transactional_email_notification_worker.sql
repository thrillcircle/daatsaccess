-- Connect the existing notification outbox to Access transactional email delivery.
-- Email is intentionally selective: security/account verification is handled by dedicated
-- auth/onboarding flows; this worker handles durable passenger records such as money,
-- cancellations, quotes and useful advance reminders. Fast-moving trip status stays in-app
-- (and later push/SMS/WhatsApp) rather than flooding email.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

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

  -- These are service/financial records, not optional marketing messages.
  v_email_required := v_recipient_is_passenger AND NEW.notification_type IN (
    'payment_received',
    'payment_failed',
    'refund_queued',
    'refund_processed',
    'cancellation_balance_due',
    'ride_cancelled'
  );

  -- These are useful but respect the passenger's Email preference.
  v_email_optional := v_recipient_is_passenger AND NEW.notification_type IN (
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
      notification_outbox_id,recipient_user_id,channel,status,provider,last_error
    ) VALUES (
      NEW.id,
      NEW.recipient_user_id,
      v_channel,
      CASE
        WHEN NOT v_enabled THEN 'skipped'
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
      END
    ) ON CONFLICT(notification_outbox_id,channel) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_plan_notification_channels ON public.notification_outbox;
CREATE TRIGGER trg_plan_notification_channels
AFTER INSERT ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION private.plan_notification_channels();

-- The worker route presents the raw token stored in Supabase Vault. Only service_role may
-- ask PostgreSQL to validate it; the browser never sees or reads the secret.
CREATE OR REPLACE FUNCTION public.service_validate_notification_worker_token(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'vault','pg_temp'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM vault.decrypted_secrets s
    WHERE s.name='access_notification_worker_token'
      AND length(COALESCE(p_token,'')) >= 32
      AND s.decrypted_secret = p_token
  );
$function$;

REVOKE ALL ON FUNCTION public.service_validate_notification_worker_token(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_validate_notification_worker_token(text)
TO service_role;

CREATE OR REPLACE FUNCTION public.service_claim_email_notification_deliveries(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth','pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Email delivery limit must be between 1 and 100';
  END IF;

  WITH candidates AS (
    SELECT d.id
    FROM public.notification_channel_deliveries d
    WHERE d.channel='email'
      AND d.provider='lovable_email'
      AND d.attempt_count < 5
      AND (
        d.status='queued'
        OR (
          d.status='failed'
          AND d.updated_at <= now() - make_interval(mins => LEAST(60, power(2,d.attempt_count)::integer))
        )
      )
    ORDER BY d.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.notification_channel_deliveries d
    SET status='processing',
        attempt_count=d.attempt_count+1,
        last_error=NULL,
        updated_at=now()
    FROM candidates c
    WHERE d.id=c.id
    RETURNING d.*
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'delivery_id',c.id,
      'outbox_id',o.id,
      'recipient_user_id',c.recipient_user_id,
      'recipient_email',u.email,
      'notification_type',o.notification_type,
      'title',o.title,
      'message',o.message,
      'ride_id',o.ride_id,
      'service_booking_id',o.service_booking_id,
      'deduplication_key',o.deduplication_key,
      'attempt_count',c.attempt_count,
      'payment_amount',p.amount,
      'payment_currency',p.currency,
      'payment_reference',p.merchant_payment_id,
      'provider_payment_id',p.provider_payment_id
    ) ORDER BY c.created_at
  ),'[]'::jsonb)
  INTO v_result
  FROM claimed c
  JOIN public.notification_outbox o ON o.id=c.notification_outbox_id
  JOIN auth.users u ON u.id=c.recipient_user_id
  LEFT JOIN public.payments p ON
    o.deduplication_key='payment-received:'||p.id::text
    OR o.deduplication_key='payment-failed:'||p.id::text
  WHERE NULLIF(trim(u.email::text),'') IS NOT NULL;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.service_claim_email_notification_deliveries(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_email_notification_deliveries(integer)
TO service_role;

CREATE OR REPLACE FUNCTION public.service_finish_email_notification_delivery(
  p_delivery_id uuid,
  p_success boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_attempt integer;
BEGIN
  SELECT attempt_count INTO v_attempt
  FROM public.notification_channel_deliveries
  WHERE id=p_delivery_id AND channel='email'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Email delivery not found'; END IF;

  UPDATE public.notification_channel_deliveries
  SET status=CASE WHEN p_success THEN 'delivered' ELSE 'failed' END,
      provider_message_id=COALESCE(NULLIF(trim(COALESCE(p_provider_message_id,'')),''),provider_message_id),
      last_error=CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error,'Email delivery failed'),1000) END,
      delivered_at=CASE WHEN p_success THEN now() ELSE delivered_at END,
      updated_at=now()
  WHERE id=p_delivery_id;

  IF NOT p_success AND v_attempt >= 5 THEN
    INSERT INTO public.operational_alerts(
      alert_type,severity,title,details,deduplication_key
    ) VALUES (
      'notification_delivery_failure',
      'warning',
      'Transactional email delivery failed repeatedly',
      jsonb_build_object('delivery_id',p_delivery_id,'channel','email','last_error',left(COALESCE(p_error,''),500)),
      'email-notification-failed:'||p_delivery_id::text
    ) ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.service_finish_email_notification_delivery(uuid,boolean,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_finish_email_notification_delivery(uuid,boolean,text,text)
TO service_role;

-- Fire-and-forget request from PostgreSQL to the published Access server worker.
CREATE OR REPLACE FUNCTION private.trigger_transactional_email_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','vault','net','pg_temp'
AS $function$
DECLARE v_token text;
BEGIN
  SELECT s.decrypted_secret INTO v_token
  FROM vault.decrypted_secrets s
  WHERE s.name='access_notification_worker_token'
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NULLIF(v_token,'') IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := 'https://daats.app/api/internal/notification-email-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-access-worker-token',v_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.trigger_transactional_email_worker()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.trigger_transactional_email_worker() TO service_role;

-- Scheduler is safe before provisioning the vault secret: the function simply no-ops.
DO $block$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='access-transactional-email-worker';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END
$block$;

SELECT cron.schedule(
  'access-transactional-email-worker',
  '* * * * *',
  $$SELECT private.trigger_transactional_email_worker();$$
);

NOTIFY pgrst, 'reload schema';
