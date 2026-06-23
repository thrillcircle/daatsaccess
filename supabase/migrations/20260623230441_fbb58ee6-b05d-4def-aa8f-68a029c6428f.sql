DROP POLICY IF EXISTS "avatars readable to signed in users" ON storage.objects;

CREATE POLICY "Users can read their own avatar"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);