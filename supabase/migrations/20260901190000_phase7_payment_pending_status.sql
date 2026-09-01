-- Phase 7 automatic passenger checkout.
-- `payment_pending` is an internal pre-submission state. A ride only becomes
-- `requested` after PayFast confirms the authoritative fare through ITN.
--
-- Keep this enum change in its own migration: PostgreSQL requires the newly
-- added enum value to be committed before later migration statements use it.

ALTER TYPE public.ride_status
  ADD VALUE IF NOT EXISTS 'payment_pending' BEFORE 'requested';
