ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'superseded';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'cancelled';