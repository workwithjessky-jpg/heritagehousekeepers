-- =====================================================================
-- Migration 9: "On my way" — a cleaner tells the office they are heading to a job
-- =====================================================================
alter table job_assignments add column if not exists on_my_way_at timestamptz;
alter table job_assignments add column if not exists eta_minutes int check (eta_minutes between 0 and 600);

-- Cleaner taps "On my way" (optionally with an ETA). Notifies the office; returns details for outbound alerts.
create or replace function mark_on_my_way(p_job uuid, p_eta int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['cleaner']);
  v_job cleaning_jobs;
  v_name text;
  v_eta text;
begin
  select * into v_job from cleaning_jobs where id = p_job;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status in ('completed', 'cancelled') then raise exception 'This job is already %', v_job.status; end if;
  if exists (select 1 from attendance_records where job_id = p_job and employee_id = v_uid) then
    raise exception 'You have already clocked in to this job';
  end if;
  update job_assignments set on_my_way_at = now(), eta_minutes = p_eta,
         status = case when status = 'assigned' then 'confirmed' else status end
   where job_id = p_job and employee_id = v_uid;
  if not found then raise exception 'You are not assigned to this job'; end if;

  select full_name into v_name from users where id = v_uid;
  v_eta := case when p_eta is not null then format(' · arriving in about %s min', p_eta) else '' end;
  perform notify_staff('on_my_way', 'on_my_way', format('%s is on the way', v_name), v_job.title || v_eta, '/admin/jobs/' || p_job);
  return jsonb_build_object('employee', v_name, 'job_id', p_job, 'title', v_job.title, 'eta_minutes', p_eta, 'at', now());
end $$;

revoke execute on function mark_on_my_way(uuid, int) from public, anon;
grant execute on function mark_on_my_way(uuid, int) to authenticated;
