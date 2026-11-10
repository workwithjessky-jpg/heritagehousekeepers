-- =====================================================================
-- Migration 8: run the attendance checks inside the database every 5 minutes
--   Missed clock-ins and forgotten clock-outs must be caught within minutes, but
--   Vercel's free plan only allows a daily cron. pg_cron (built into Supabase)
--   runs run_attendance_checks() on its own — no secrets or external service needed.
--   The function is idempotent: each assignment / shift is alerted at most once.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'heritage-attendance-checks';
    perform cron.schedule('heritage-attendance-checks', '*/5 * * * *', 'select public.run_attendance_checks()');
  else
    raise notice 'pg_cron not available here; attendance checks rely on /api/cron/attendance';
  end if;
end $$;
