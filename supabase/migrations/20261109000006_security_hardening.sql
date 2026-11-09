-- =====================================================================
-- Migration 6: hardening from Supabase security advisor
--   * pin search_path on the remaining helper functions
--   * trigger functions are not API endpoints: revoke direct EXECUTE
--     (triggers still fire — EXECUTE is only checked when a trigger is created)
-- =====================================================================
alter function public.haversine_m(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.storage_job_id(text) set search_path = public;

revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.guard_users_update() from public, anon, authenticated;
revoke execute on function public.guard_profile_pay_fields() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.on_announcement_insert() from public, anon, authenticated;
revoke execute on function public.on_assignment_insert() from public, anon, authenticated;
revoke execute on function public.on_job_update() from public, anon, authenticated;
revoke execute on function public.on_photo_insert() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
