
REVOKE EXECUTE ON FUNCTION public.notify_ride_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ride_updated() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ride_edited() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_review_submitted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_approaching_scheduled_rides() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.short_addr(text) FROM PUBLIC, anon, authenticated;
