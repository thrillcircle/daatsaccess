-- Complete the quote lifecycle without removing the legacy `rejected` value.
-- Values are added in a dedicated migration so later migrations may safely use
-- them after this transaction commits.

ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'superseded';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'cancelled';
