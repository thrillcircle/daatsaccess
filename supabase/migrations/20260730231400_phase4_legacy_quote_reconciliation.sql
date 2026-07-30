-- Phase 4 preflight: reconcile legacy quote rows before the versioned quotation
-- migration creates uniqueness constraints. No quote is deleted.

ALTER TABLE public.service_quotes
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_quote_id uuid
    REFERENCES public.service_quotes(id) ON DELETE SET NULL;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY booking_id
      ORDER BY created_at, id
    ) AS revision_number
  FROM public.service_quotes
)
UPDATE public.service_quotes quote
SET revision_number = ranked.revision_number
FROM ranked
WHERE ranked.id = quote.id
  AND quote.revision_number IS DISTINCT FROM ranked.revision_number;

UPDATE public.service_quotes
SET sent_at = COALESCE(sent_at, updated_at, created_at)
WHERE status::text = 'sent';

UPDATE public.service_quotes
SET accepted_at = COALESCE(accepted_at, updated_at, created_at)
WHERE status::text = 'accepted';

UPDATE public.service_quotes
SET declined_at = COALESCE(declined_at, updated_at, created_at)
WHERE status::text = 'rejected';

UPDATE public.service_quotes
SET expired_at = COALESCE(expired_at, updated_at, created_at)
WHERE status::text = 'expired';

WITH ranked_sent AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY booking_id
      ORDER BY COALESCE(sent_at, created_at) DESC, revision_number DESC, id DESC
    ) AS latest_quote_id,
    row_number() OVER (
      PARTITION BY booking_id
      ORDER BY COALESCE(sent_at, created_at) DESC, revision_number DESC, id DESC
    ) AS position
  FROM public.service_quotes
  WHERE status::text = 'sent'
    AND accepted_at IS NULL
    AND declined_at IS NULL
    AND expired_at IS NULL
    AND superseded_at IS NULL
    AND cancelled_at IS NULL
)
UPDATE public.service_quotes quote
SET superseded_at = COALESCE(quote.superseded_at, now()),
    superseded_by_quote_id = ranked_sent.latest_quote_id
FROM ranked_sent
WHERE ranked_sent.id = quote.id
  AND ranked_sent.position > 1;

COMMENT ON COLUMN public.service_quotes.revision_number IS
  'Monotonic revision within a booking. Legacy rows were ranked by creation time before the uniqueness constraint was added.';
