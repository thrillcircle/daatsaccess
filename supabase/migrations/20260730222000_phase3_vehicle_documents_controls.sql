-- Phase 3 document administration and privacy hardening.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-documents',
  'vehicle-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "Admins read vehicle document files" ON storage.objects;
CREATE POLICY "Admins read vehicle document files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vehicle-documents'
  AND private.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Admins upload vehicle document files" ON storage.objects;
CREATE POLICY "Admins upload vehicle document files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-documents'
  AND private.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Admins replace vehicle document files" ON storage.objects;
CREATE POLICY "Admins replace vehicle document files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vehicle-documents'
  AND private.has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  bucket_id = 'vehicle-documents'
  AND private.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Admins remove vehicle document files" ON storage.objects;
CREATE POLICY "Admins remove vehicle document files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vehicle-documents'
  AND private.has_role(auth.uid(), 'admin'::app_role)
);

-- Drivers receive compliance status through a restricted RPC instead of direct
-- vehicle_documents access, so storage paths and private document numbers are
-- not exposed to driver clients.
DROP POLICY IF EXISTS "Drivers read assigned vehicle document status"
  ON public.vehicle_documents;

CREATE OR REPLACE FUNCTION public.driver_current_vehicle_document_status()
RETURNS TABLE (
  vehicle_id uuid,
  document_type text,
  expires_at date,
  status text,
  is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    document.vehicle_id,
    document.document_type,
    document.expires_at,
    document.status,
    document.is_current
  FROM public.vehicle_documents document
  JOIN public.vehicle_driver_assignments assignment
    ON assignment.vehicle_id = document.vehicle_id
  WHERE assignment.driver_id = auth.uid()
    AND assignment.status = 'active'
    AND assignment.start_at <= now()
    AND (assignment.end_at IS NULL OR assignment.end_at > now())
    AND document.is_current
    AND document.status = 'current';
$$;

REVOKE ALL ON FUNCTION public.driver_current_vehicle_document_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_current_vehicle_document_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_vehicle_document(
  p_vehicle_id uuid,
  p_document_type text,
  p_document_number text DEFAULT NULL,
  p_issued_at date DEFAULT NULL,
  p_expires_at date DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_document public.vehicle_documents%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_document_type NOT IN (
    'roadworthy', 'license_disc', 'insurance', 'registration', 'permit', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid vehicle document type';
  END IF;

  IF p_storage_path IS NOT NULL
     AND p_storage_path NOT LIKE p_vehicle_id::text || '/%' THEN
    RAISE EXCEPTION 'Vehicle document storage path must be scoped to the vehicle';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT request.result
    INTO v_result
    FROM public.fleet_operation_requests request
    WHERE request.idempotency_key = p_idempotency_key
      AND request.operation_type = 'save_vehicle_document'
      AND request.actor_id = v_actor;
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  END IF;

  PERFORM 1
  FROM public.vehicle_profiles
  WHERE id = p_vehicle_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;

  UPDATE public.vehicle_documents
  SET status = 'replaced',
      is_current = false,
      updated_at = now()
  WHERE vehicle_id = p_vehicle_id
    AND document_type = p_document_type
    AND is_current;

  INSERT INTO public.vehicle_documents (
    vehicle_id,
    document_type,
    document_number,
    issued_at,
    expires_at,
    storage_path,
    status,
    is_current,
    uploaded_by
  ) VALUES (
    p_vehicle_id,
    p_document_type,
    NULLIF(trim(p_document_number), ''),
    p_issued_at,
    p_expires_at,
    NULLIF(trim(p_storage_path), ''),
    CASE
      WHEN p_expires_at IS NOT NULL AND p_expires_at < current_date THEN 'expired'
      ELSE 'current'
    END,
    true,
    v_actor
  )
  RETURNING * INTO v_document;

  -- Maintain the temporary canonical expiry columns while old reads are being
  -- removed. This is a one-way compatibility update only.
  UPDATE public.vehicle_profiles
  SET roadworthy_expiry_date = CASE
        WHEN p_document_type = 'roadworthy' THEN p_expires_at
        ELSE roadworthy_expiry_date
      END,
      license_disc_expiry_date = CASE
        WHEN p_document_type = 'license_disc' THEN p_expires_at
        ELSE license_disc_expiry_date
      END,
      insurance_expiry_date = CASE
        WHEN p_document_type = 'insurance' THEN p_expires_at
        ELSE insurance_expiry_date
      END
  WHERE id = p_vehicle_id;

  v_result := to_jsonb(v_document);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.fleet_operation_requests (
      idempotency_key,
      operation_type,
      actor_id,
      result
    ) VALUES (
      p_idempotency_key,
      'save_vehicle_document',
      v_actor,
      v_result
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_vehicle_document(
  p_document_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_actor uuid := public.fleet_require_admin();
  v_document public.vehicle_documents%ROWTYPE;
BEGIN
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to remove a vehicle document';
  END IF;

  SELECT * INTO v_document
  FROM public.vehicle_documents
  WHERE id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle document not found'; END IF;

  UPDATE public.vehicle_documents
  SET status = 'removed',
      is_current = false,
      updated_at = now()
  WHERE id = p_document_id
  RETURNING * INTO v_document;

  INSERT INTO public.vehicle_status_events (
    vehicle_id,
    previous_status,
    new_status,
    reason,
    performed_by
  )
  SELECT
    vehicle.id,
    vehicle.status,
    vehicle.status,
    'Document removed (' || v_document.document_type || '): ' || trim(p_reason),
    v_actor
  FROM public.vehicle_profiles vehicle
  WHERE vehicle.id = v_document.vehicle_id;

  RETURN to_jsonb(v_document);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_vehicle_document(
  uuid, text, text, date, date, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_vehicle_document(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_vehicle_document(
  uuid, text, text, date, date, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_vehicle_document(uuid, text) TO authenticated;
