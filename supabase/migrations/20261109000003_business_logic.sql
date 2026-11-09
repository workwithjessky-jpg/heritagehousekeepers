-- =====================================================================
-- Migration 3: business logic — notifications, scheduling intelligence,
-- GPS attendance, timesheets, payroll, time off, audit trail.
-- All mutating RPCs are SECURITY DEFINER and validate auth.uid() + role
-- themselves, so business rules cannot be bypassed from the browser.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------
create or replace function settings() returns company_settings
language sql stable security definer set search_path = public as $$
  select * from company_settings where id = 1
$$;

-- Great-circle distance in metres
create or replace function haversine_m(lat1 double precision, lon1 double precision,
                                       lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

create or replace function require_role(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text := app_role();
begin
  if auth.uid() is null or v_role is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not (v_role = any(p_roles)) then
    raise exception 'Your role (%) is not allowed to perform this action', v_role using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_details)
$$;

-- ---------------------------------------------------------------------
-- Notifications (in-app + delivery outbox for email/SMS/WhatsApp)
-- ---------------------------------------------------------------------
create or replace function notify(p_user uuid, p_type text, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_user users;
  v_s company_settings := settings();
begin
  select * into v_user from users where id = p_user and is_active;
  if not found then return null; end if;
  insert into notifications (user_id, type, title, body, link)
  values (p_user, p_type, p_title, p_body, p_link) returning id into v_id;
  if coalesce((v_s.notification_prefs->>'email_enabled')::boolean, false) and v_user.email_notifications then
    insert into notification_deliveries (notification_id, channel, destination)
    values (v_id, 'email', v_user.email);
  end if;
  return v_id;
end $$;

-- Notify all management users, honouring the per-event toggles in settings
create or replace function notify_staff(p_event text, p_type text, p_title text, p_body text, p_link text,
                                        p_roles text[] default array['owner','ops_manager','office_admin'])
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not coalesce(((settings()).notification_prefs->'events'->>p_event)::boolean, true) then
    return;
  end if;
  for r in select id from users where is_active and role_key = any(p_roles) loop
    perform notify(r.id, p_type, p_title, p_body, p_link);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Scheduling intelligence
-- ---------------------------------------------------------------------
-- Returns one row per problem; severity 'block' prevents assignment.
create or replace function check_assignment_conflicts(p_employee uuid, p_start timestamptz, p_end timestamptz,
                                                      p_exclude_job uuid default null, p_property uuid default null)
returns table (severity text, code text, message text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_s company_settings := settings();
  v_tz text := v_s.timezone;
  v_local_start timestamp := p_start at time zone v_tz;
  v_local_end timestamp := p_end at time zone v_tz;
  r record;
  v_dist double precision;
  v_needed_min double precision;
  v_gap_min double precision;
  v_prop properties;
  v_week_hours numeric;
begin
  if not is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if not exists (select 1 from users where id = p_employee and is_active) then
    return query select 'block', 'inactive', 'Employee account is inactive.';
  end if;

  -- 1. overlapping jobs (hard block)
  for r in
    select j.title, j.scheduled_start, j.scheduled_end from job_assignments a
    join cleaning_jobs j on j.id = a.job_id
    where a.employee_id = p_employee and j.status <> 'cancelled'
      and (p_exclude_job is null or j.id <> p_exclude_job)
      and tstzrange(j.scheduled_start, j.scheduled_end) && tstzrange(p_start, p_end)
  loop
    return query select 'block', 'overlap',
      format('Overlaps "%s" (%s–%s).', r.title,
             to_char(r.scheduled_start at time zone v_tz, 'Mon DD HH12:MI AM'),
             to_char(r.scheduled_end at time zone v_tz, 'HH12:MI AM'));
  end loop;

  -- 2. approved / pending time off
  for r in
    select start_date, end_date, status from time_off_requests
    where employee_id = p_employee and status in ('approved','pending')
      and daterange(start_date, end_date, '[]') && daterange(v_local_start::date, v_local_end::date, '[]')
  loop
    return query select case when r.status = 'approved' then 'block' else 'warn' end, 'time_off',
      format('%s time off %s → %s.', initcap(r.status::text), r.start_date, r.end_date);
  end loop;

  -- 3. weekly availability (only checked if the employee has submitted availability)
  if exists (select 1 from employee_availability where employee_id = p_employee) and not exists (
      select 1 from employee_availability
      where employee_id = p_employee and weekday = extract(dow from v_local_start)::int
        and start_time <= v_local_start::time and end_time >= v_local_end::time) then
    return query select 'warn', 'unavailable', 'Outside the employee''s submitted availability for that day.';
  end if;

  -- 4. travel time from previous / to next job the same day
  if p_property is not null then
    select * into v_prop from properties where id = p_property;
    for r in
      select j.title, j.scheduled_start, j.scheduled_end, p.latitude, p.longitude from job_assignments a
      join cleaning_jobs j on j.id = a.job_id join properties p on p.id = j.property_id
      where a.employee_id = p_employee and j.status <> 'cancelled'
        and (p_exclude_job is null or j.id <> p_exclude_job)
        and (j.scheduled_start at time zone v_tz)::date = v_local_start::date
        and not (tstzrange(j.scheduled_start, j.scheduled_end) && tstzrange(p_start, p_end))
    loop
      if r.scheduled_end <= p_start then
        v_gap_min := extract(epoch from (p_start - r.scheduled_end)) / 60;
      else
        v_gap_min := extract(epoch from (r.scheduled_start - p_end)) / 60;
      end if;
      v_needed_min := v_s.min_travel_buffer_minutes;
      if v_prop.latitude is not null and r.latitude is not null then
        v_dist := haversine_m(v_prop.latitude, v_prop.longitude, r.latitude, r.longitude);
        -- road distance ≈ 1.3 × straight line
        v_needed_min := greatest(v_needed_min, (v_dist * 1.3 / 1000) / v_s.avg_travel_speed_kmh * 60);
      end if;
      if v_gap_min < v_needed_min then
        return query select 'warn', 'travel',
          format('Only %s min between this job and "%s"; about %s min travel needed.',
                 round(v_gap_min), r.title, round(v_needed_min));
      end if;
    end loop;
  end if;

  -- 5. workload
  select coalesce(sum(extract(epoch from (j.scheduled_end - j.scheduled_start)) / 3600), 0) into v_week_hours
  from job_assignments a join cleaning_jobs j on j.id = a.job_id
  where a.employee_id = p_employee and j.status <> 'cancelled'
    and (p_exclude_job is null or j.id <> p_exclude_job)
    and date_trunc('week', j.scheduled_start at time zone v_tz) = date_trunc('week', v_local_start);
  v_week_hours := v_week_hours + extract(epoch from (p_end - p_start)) / 3600;
  if v_week_hours > v_s.max_weekly_hours_alert then
    return query select 'warn', 'workload',
      format('Would bring scheduled hours this week to %s (alert threshold %s).', round(v_week_hours, 1), v_s.max_weekly_hours_alert);
  end if;
end $$;

-- Ranked cleaner recommendations for a job
create or replace function recommend_cleaners(p_job uuid)
returns table (employee_id uuid, full_name text, team text, score numeric, week_hours numeric,
               distance_km numeric, blocked boolean, warnings text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_job cleaning_jobs;
  v_prop properties;
  v_tz text := (settings()).timezone;
begin
  if not is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_job from cleaning_jobs where id = p_job;
  if not found then raise exception 'Job not found'; end if;
  select * into v_prop from properties where id = v_job.property_id;

  return query
  with c as (
    select u.id, u.full_name, ep.team,
      (select coalesce(sum(extract(epoch from (j.scheduled_end - j.scheduled_start)) / 3600), 0)
         from job_assignments a join cleaning_jobs j on j.id = a.job_id
        where a.employee_id = u.id and j.status <> 'cancelled'
          and date_trunc('week', j.scheduled_start at time zone v_tz) = date_trunc('week', v_job.scheduled_start at time zone v_tz))::numeric as wh,
      -- distance from the cleaner's nearest same-day job, else from home
      coalesce(
        (select min(haversine_m(v_prop.latitude, v_prop.longitude, p.latitude, p.longitude))
           from job_assignments a join cleaning_jobs j on j.id = a.job_id join properties p on p.id = j.property_id
          where a.employee_id = u.id and j.status <> 'cancelled' and j.id <> p_job
            and (j.scheduled_start at time zone v_tz)::date = (v_job.scheduled_start at time zone v_tz)::date),
        case when ep.home_latitude is not null then haversine_m(v_prop.latitude, v_prop.longitude, ep.home_latitude, ep.home_longitude) end
      ) as dist_m,
      (select array_agg(x.message) from check_assignment_conflicts(u.id, v_job.scheduled_start, v_job.scheduled_end, p_job, v_job.property_id) x) as msgs,
      exists (select 1 from check_assignment_conflicts(u.id, v_job.scheduled_start, v_job.scheduled_end, p_job, v_job.property_id) x where x.severity = 'block') as blk
    from users u join employee_profiles ep on ep.user_id = u.id
    where u.role_key = 'cleaner' and u.is_active and ep.employment_status in ('active','onboarding')
      and not exists (select 1 from job_assignments a where a.job_id = p_job and a.employee_id = u.id)
  )
  select c.id, c.full_name, c.team,
    round((100
      - case when c.blk then 100 else 0 end
      - coalesce(array_length(c.msgs, 1), 0) * 12
      - least(c.wh, 40) * 0.8
      - coalesce(least(c.dist_m / 1000, 40), 10) * 0.9
      + case when v_prop.assigned_team is not null and c.team = v_prop.assigned_team then 10 else 0 end)::numeric, 1),
    round(c.wh, 1), round((c.dist_m / 1000)::numeric, 1), c.blk, coalesce(c.msgs, '{}')
  from c
  order by c.blk, 4 desc;
end $$;

-- Assign (or re-assign) a cleaner. Overlaps / approved time off are blocked unless forced by a supervisor.
create or replace function assign_employee(p_job uuid, p_employee uuid, p_team_lead boolean default false,
                                           p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager','office_admin']);
  v_job cleaning_jobs;
  v_blocks text[];
  v_warns text[];
begin
  select * into v_job from cleaning_jobs where id = p_job for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status in ('completed','cancelled') then
    raise exception 'Cannot assign cleaners to a % job', v_job.status;
  end if;
  if not exists (select 1 from users where id = p_employee and role_key = 'cleaner' and is_active) then
    raise exception 'Only active cleaners can be assigned';
  end if;

  select array_agg(message) filter (where severity = 'block'), array_agg(message) filter (where severity = 'warn')
    into v_blocks, v_warns
  from check_assignment_conflicts(p_employee, v_job.scheduled_start, v_job.scheduled_end, p_job, v_job.property_id);

  if v_blocks is not null and not (p_force and is_supervisor()) then
    raise exception 'Scheduling conflict: %', array_to_string(v_blocks, ' ') using errcode = 'P0001';
  end if;

  if p_team_lead then
    update job_assignments set is_team_lead = false where job_id = p_job;
  end if;
  insert into job_assignments (job_id, employee_id, is_team_lead, assigned_by)
  values (p_job, p_employee, p_team_lead, v_uid)
  on conflict (job_id, employee_id) do update set is_team_lead = excluded.is_team_lead;

  if v_job.status = 'scheduled' or v_job.status = 'needs_attention' then
    update cleaning_jobs set status = 'assigned' where id = p_job;
  end if;

  perform write_audit('assign', 'cleaning_jobs', p_job::text,
    jsonb_build_object('employee_id', p_employee, 'team_lead', p_team_lead, 'forced', p_force and v_blocks is not null, 'warnings', v_warns));
  return jsonb_build_object('warnings', coalesce(to_jsonb(v_warns), '[]'::jsonb),
                            'overridden', coalesce(to_jsonb(v_blocks), '[]'::jsonb));
end $$;

create or replace function unassign_employee(p_job uuid, p_employee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_job cleaning_jobs;
begin
  perform require_role(array['owner','ops_manager','office_admin']);
  select * into v_job from cleaning_jobs where id = p_job;
  if exists (select 1 from attendance_records where job_id = p_job and employee_id = p_employee) then
    raise exception 'This cleaner already clocked in on the job; it cannot be unassigned';
  end if;
  delete from job_assignments where job_id = p_job and employee_id = p_employee;
  perform notify(p_employee, 'job_unassigned', 'Removed from a job',
    format('You are no longer scheduled for %s on %s.', v_job.title,
           to_char(v_job.scheduled_start at time zone (settings()).timezone, 'Dy Mon DD at HH12:MI AM')), '/app/schedule');
  if not exists (select 1 from job_assignments where job_id = p_job) and v_job.status in ('assigned','confirmed') then
    update cleaning_jobs set status = 'scheduled' where id = p_job;
  end if;
  perform write_audit('unassign', 'cleaning_jobs', p_job::text, jsonb_build_object('employee_id', p_employee));
end $$;

-- Cleaner confirms they've seen the assignment
create or replace function confirm_assignment(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['cleaner']);
begin
  update job_assignments set status = 'confirmed' where job_id = p_job and employee_id = v_uid;
  if not found then raise exception 'You are not assigned to this job'; end if;
  if not exists (select 1 from job_assignments where job_id = p_job and status <> 'confirmed') then
    update cleaning_jobs set status = 'confirmed' where id = p_job and status = 'assigned';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Job change notifications (assignment, reschedule, cancel)
-- ---------------------------------------------------------------------
create or replace function on_assignment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_job cleaning_jobs; v_tz text := (settings()).timezone;
begin
  select * into v_job from cleaning_jobs where id = new.job_id;
  perform notify(new.employee_id, 'job_assigned', 'New job assigned',
    format('%s — %s', v_job.title, to_char(v_job.scheduled_start at time zone v_tz, 'Dy Mon DD, HH12:MI AM')),
    '/app/jobs/' || new.job_id);
  return new;
end $$;
create trigger assignment_notify after insert on job_assignments for each row execute function on_assignment_insert();

create or replace function on_job_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_tz text := (settings()).timezone;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for r in select employee_id from job_assignments where job_id = new.id loop
      perform notify(r.employee_id, 'job_cancelled', 'Appointment cancelled',
        format('%s on %s was cancelled.%s', new.title, to_char(new.scheduled_start at time zone v_tz, 'Dy Mon DD'),
               coalesce(' Reason: ' || new.cancelled_reason, '')), '/app/schedule');
    end loop;
    perform notify_staff('schedule_change', 'job_cancelled', 'Job cancelled', new.title, '/admin/jobs/' || new.id);
  elsif new.scheduled_start is distinct from old.scheduled_start or new.scheduled_end is distinct from old.scheduled_end then
    for r in select employee_id from job_assignments where job_id = new.id loop
      perform notify(r.employee_id, 'job_rescheduled', 'Job rescheduled',
        format('%s moved to %s – %s.', new.title,
               to_char(new.scheduled_start at time zone v_tz, 'Dy Mon DD, HH12:MI AM'),
               to_char(new.scheduled_end at time zone v_tz, 'HH12:MI AM')), '/app/jobs/' || new.id);
    end loop;
    perform notify_staff('schedule_change', 'job_rescheduled', 'Schedule changed', new.title, '/admin/jobs/' || new.id);
  elsif (new.instructions, new.property_id, new.checklist_id) is distinct from (old.instructions, old.property_id, old.checklist_id) then
    for r in select employee_id from job_assignments where job_id = new.id loop
      perform notify(r.employee_id, 'job_updated', 'Job details updated', new.title, '/app/jobs/' || new.id);
    end loop;
  end if;
  return new;
end $$;
create trigger job_update_notify after update on cleaning_jobs for each row execute function on_job_update();

-- Recurring series: create the first job + following occurrences in one call
create or replace function create_job_series(p_job jsonb, p_occurrences int default 1)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager','office_admin']);
  v_rule text := coalesce(p_job->>'recurrence_rule', 'none');
  v_group uuid := case when v_rule <> 'none' then gen_random_uuid() end;
  v_start timestamptz := (p_job->>'scheduled_start')::timestamptz;
  v_end timestamptz := (p_job->>'scheduled_end')::timestamptz;
  v_step interval := case v_rule when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days'
                                 when 'monthly' then interval '1 month' else interval '0' end;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_prop properties;
  i int;
begin
  if p_occurrences < 1 or p_occurrences > 52 then raise exception 'Occurrences must be between 1 and 52'; end if;
  if v_rule = 'none' then p_occurrences := 1; end if;
  select * into v_prop from properties where id = (p_job->>'property_id')::uuid;
  if not found then raise exception 'Property not found'; end if;
  for i in 0 .. p_occurrences - 1 loop
    insert into cleaning_jobs (client_id, property_id, checklist_id, title, cleaning_type, scheduled_start, scheduled_end,
                               price, instructions, recurrence_rule, recurrence_group_id, parent_job_id, created_by, is_demo)
    values (v_prop.client_id, v_prop.id, nullif(p_job->>'checklist_id','')::uuid,
            p_job->>'title', p_job->>'cleaning_type', v_start + v_step * i, v_end + v_step * i,
            nullif(p_job->>'price','')::numeric, nullif(p_job->>'instructions',''), v_rule, v_group,
            nullif(p_job->>'parent_job_id','')::uuid, v_uid, coalesce((p_job->>'is_demo')::boolean, false))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  perform write_audit('create', 'cleaning_jobs', v_ids[1]::text, jsonb_build_object('occurrences', p_occurrences, 'rule', v_rule));
  return v_ids;
end $$;

-- ---------------------------------------------------------------------
-- GPS attendance
-- ---------------------------------------------------------------------
create or replace function record_location_consent()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['cleaner','owner','ops_manager','office_admin']);
begin
  update employee_profiles set location_consent_at = now() where user_id = v_uid;
end $$;

create or replace function clock_in(p_job uuid, p_lat double precision default null, p_lng double precision default null,
                                    p_accuracy double precision default null, p_exception_reason text default null)
returns attendance_records language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['cleaner']);
  v_s company_settings := settings();
  v_job cleaning_jobs;
  v_prop properties;
  v_name text;
  v_radius int;
  v_dist double precision;
  v_loc location_status;
  v_status attendance_status := 'clocked_in';
  v_flags text[] := '{}';
  v_rec attendance_records;
begin
  select * into v_job from cleaning_jobs where id = p_job for update;
  if not found or not exists (select 1 from job_assignments where job_id = p_job and employee_id = v_uid) then
    raise exception 'You are not assigned to this job';
  end if;
  if v_job.status in ('cancelled','completed') then
    raise exception 'This job is %', v_job.status;
  end if;
  if exists (select 1 from attendance_records where employee_id = v_uid and clock_out_at is null) then
    raise exception 'You are already clocked in to a job. Clock out first.' using errcode = 'P0002';
  end if;
  if exists (select 1 from attendance_records where employee_id = v_uid and job_id = p_job) then
    v_flags := v_flags || 'duplicate_clock_in'::text;
  end if;
  if (select location_consent_at from employee_profiles where user_id = v_uid) is null then
    raise exception 'Please review and accept the location policy before clocking in' using errcode = 'P0003';
  end if;
  if now() < v_job.scheduled_start - interval '2 hours' then
    raise exception 'Too early: this job starts at %', to_char(v_job.scheduled_start at time zone v_s.timezone, 'HH12:MI AM');
  end if;
  if now() > v_job.scheduled_start + make_interval(mins => v_s.late_grace_minutes) then
    v_flags := v_flags || 'late_clock_in'::text;
  end if;

  select * into v_prop from properties where id = v_job.property_id;
  v_radius := coalesce(v_prop.geofence_radius_m, v_s.default_geofence_m);

  if p_lat is null or p_lng is null then
    if coalesce(trim(p_exception_reason), '') = '' then
      raise exception 'Location unavailable. Submit a reason so a manager can review this clock-in.' using errcode = 'P0004';
    end if;
    v_loc := 'unavailable';
    v_status := 'exception_pending';
    v_flags := v_flags || 'gps_unavailable'::text;
  elsif v_prop.latitude is null then
    v_loc := 'no_property_coordinates';
    v_flags := v_flags || 'property_not_geocoded'::text;
  else
    v_dist := haversine_m(p_lat, p_lng, v_prop.latitude, v_prop.longitude);
    if v_dist <= v_radius + least(coalesce(p_accuracy, 0), 100) then
      v_loc := 'verified';
    else
      v_loc := 'outside_geofence';
      v_flags := v_flags || 'outside_geofence'::text;
    end if;
  end if;

  insert into attendance_records (job_id, employee_id, clock_in_latitude, clock_in_longitude, clock_in_accuracy_m,
                                  clock_in_distance_m, clock_in_location, geofence_radius_m, status, exception_reason, flags)
  values (p_job, v_uid, p_lat, p_lng, p_accuracy, v_dist, v_loc, v_radius, v_status, nullif(trim(p_exception_reason), ''), v_flags)
  returning * into v_rec;

  insert into gps_locations (attendance_id, employee_id, event, latitude, longitude, accuracy_m, distance_m, within_geofence)
  values (v_rec.id, v_uid, 'clock_in', p_lat, p_lng, p_accuracy, v_dist, case when v_loc = 'verified' then true when v_loc = 'outside_geofence' then false end);

  update cleaning_jobs set status = 'in_progress' where id = p_job;

  select full_name into v_name from users where id = v_uid;
  perform notify_staff('clock_in', 'clock_in', format('%s clocked in', v_name),
    format('%s · %s%s', v_job.title, replace(v_loc::text, '_', ' '),
           case when v_dist is not null then format(' (%s m from property)', round(v_dist::numeric)) else '' end),
    '/admin/attendance?focus=' || v_rec.id);
  if v_loc in ('outside_geofence','unavailable') then
    perform notify_staff('geofence', 'attendance_exception',
      case when v_loc = 'unavailable' then format('%s clocked in without GPS', v_name)
           else format('%s clocked in outside the geofence', v_name) end,
      coalesce('Reason: ' || p_exception_reason, format('%s m from %s (allowed %s m)', round(v_dist::numeric), v_prop.name, v_radius)),
      '/admin/attendance?focus=' || v_rec.id, array['owner','ops_manager']);
  end if;
  return v_rec;
end $$;

-- Returns {required_open, photos_missing} for a job, used by clock_out and the UI
create or replace function job_completion_status(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_job cleaning_jobs;
  v_open jsonb;
  v_missing text[] := '{}';
begin
  if not (is_staff() or is_assigned(p_job)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_job from cleaning_jobs where id = p_job;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'area', t.area, 'task', t.task) order by t.sort_order), '[]')
    into v_open
  from checklist_tasks t
  left join checklist_submissions s on s.task_id = t.id and s.job_id = p_job
  where t.checklist_id = v_job.checklist_id and t.is_required
    and (coalesce(s.completed, false) = false or (t.requires_photo and s.photo_path is null));
  if (settings()).require_before_after_photos then
    if not exists (select 1 from job_photos where job_id = p_job and kind = 'before') then v_missing := v_missing || 'before'::text; end if;
    if not exists (select 1 from job_photos where job_id = p_job and kind = 'after') then v_missing := v_missing || 'after'::text; end if;
  end if;
  return jsonb_build_object('required_open', v_open, 'photos_missing', to_jsonb(v_missing));
end $$;

create or replace function clock_out(p_attendance uuid, p_lat double precision default null, p_lng double precision default null,
                                     p_accuracy double precision default null, p_break_minutes int default 0,
                                     p_completion_exception text default null, p_notes text default null)
returns timesheets language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['cleaner']);
  v_s company_settings := settings();
  v_rec attendance_records;
  v_job cleaning_jobs;
  v_prop properties;
  v_profile employee_profiles;
  v_name text;
  v_dist double precision;
  v_loc location_status;
  v_break int := greatest(coalesce(p_break_minutes, 0), 0);
  v_minutes int;
  v_hours numeric;
  v_flags text[];
  v_completion jsonb;
  v_ts timesheets;
  v_week_hours numeric;
begin
  select * into v_rec from attendance_records where id = p_attendance and employee_id = v_uid for update;
  if not found then raise exception 'Attendance record not found'; end if;
  if v_rec.clock_out_at is not null then raise exception 'Already clocked out'; end if;
  select * into v_job from cleaning_jobs where id = v_rec.job_id;
  select * into v_prop from properties where id = v_job.property_id;
  select * into v_profile from employee_profiles where user_id = v_uid;
  v_flags := v_rec.flags;

  -- Is this the last cleaner still on the job? Then the job is being completed: enforce checklist/photos.
  if not exists (select 1 from attendance_records where job_id = v_job.id and clock_out_at is null and id <> v_rec.id) then
    v_completion := job_completion_status(v_job.id);
    if (jsonb_array_length(v_completion->'required_open') > 0 or jsonb_array_length(v_completion->'photos_missing') > 0)
       and coalesce(trim(p_completion_exception), '') = '' then
      raise exception 'Checklist or photos incomplete. Finish them, or explain why in the completion exception.' using errcode = 'P0005';
    end if;
  end if;

  if p_lat is null or p_lng is null then
    v_loc := 'unavailable';
    v_flags := v_flags || 'gps_unavailable_clock_out'::text;
  elsif v_prop.latitude is null then
    v_loc := 'no_property_coordinates';
  else
    v_dist := haversine_m(p_lat, p_lng, v_prop.latitude, v_prop.longitude);
    v_loc := case when v_dist <= v_rec.geofence_radius_m + least(coalesce(p_accuracy, 0), 100) then 'verified' else 'outside_geofence' end;
    if v_loc = 'outside_geofence' then v_flags := v_flags || 'clock_out_outside_geofence'::text; end if;
  end if;

  v_minutes := floor(extract(epoch from (now() - v_rec.clock_in_at)) / 60);
  -- break policy: automatic deduction when configured and the worker reported less
  if v_s.auto_break_enabled and v_minutes >= v_s.auto_break_after_hours * 60 and v_break < v_s.auto_break_minutes then
    v_break := v_s.auto_break_minutes;
    v_flags := v_flags || 'auto_break_applied'::text;
  end if;
  if v_break >= v_minutes and v_minutes > 0 then
    raise exception 'Break time cannot be longer than the shift';
  end if;
  v_hours := round(greatest(v_minutes - v_break, 0) / 60.0, 2);
  if v_minutes > v_s.max_shift_hours * 60 then v_flags := v_flags || 'unusually_long_shift'::text; end if;

  update attendance_records set
    clock_out_at = now(), clock_out_latitude = p_lat, clock_out_longitude = p_lng, clock_out_accuracy_m = p_accuracy,
    clock_out_distance_m = v_dist, clock_out_location = v_loc, break_minutes = v_break, total_minutes = v_minutes - v_break,
    status = case when status = 'exception_pending' then status else 'clocked_out' end, flags = v_flags
  where id = v_rec.id returning * into v_rec;

  insert into gps_locations (attendance_id, employee_id, event, latitude, longitude, accuracy_m, distance_m, within_geofence)
  values (v_rec.id, v_uid, 'clock_out', p_lat, p_lng, p_accuracy, v_dist,
          case when v_loc = 'verified' then true when v_loc = 'outside_geofence' then false end);

  select coalesce(sum(total_hours), 0) + v_hours into v_week_hours from timesheets
  where employee_id = v_uid and date_trunc('week', work_date) = date_trunc('week', (v_rec.clock_in_at at time zone v_s.timezone)::date);
  if v_week_hours > v_s.max_weekly_hours_alert then v_flags := v_flags || 'excessive_weekly_hours'::text; end if;

  insert into timesheets (employee_id, attendance_id, job_id, work_date, clock_in_at, clock_out_at, break_minutes,
                          total_hours, pay_rate, estimated_earnings, status, flags, employee_notes)
  values (v_uid, v_rec.id, v_job.id, (v_rec.clock_in_at at time zone v_s.timezone)::date, v_rec.clock_in_at, v_rec.clock_out_at,
          v_break, v_hours, v_profile.pay_rate, round(v_hours * v_profile.pay_rate, 2), 'draft', v_flags, nullif(trim(p_notes), ''))
  returning * into v_ts;

  select full_name into v_name from users where id = v_uid;
  perform notify_staff('clock_out', 'clock_out', format('%s clocked out', v_name),
    format('%s · %s h', v_job.title, v_hours), '/admin/attendance?focus=' || v_rec.id);

  if not exists (select 1 from attendance_records where job_id = v_job.id and clock_out_at is null) then
    update cleaning_jobs set
      status = case when coalesce(trim(p_completion_exception), '') = '' then 'completed'::job_status else 'needs_attention'::job_status end,
      completed_at = now(),
      completion_exception = nullif(trim(p_completion_exception), '')
    where id = v_job.id;
    perform notify_staff('job_completed', 'job_completed',
      case when coalesce(trim(p_completion_exception), '') = '' then 'Job completed' else 'Job finished with exceptions' end,
      v_job.title || coalesce(' — ' || p_completion_exception, ''), '/admin/jobs/' || v_job.id);
  end if;
  return v_ts;
end $$;

-- Manager decision on a GPS exception
create or replace function review_attendance_exception(p_attendance uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner','ops_manager']); v_rec attendance_records;
begin
  update attendance_records set status = case when p_approve then 'exception_approved'::attendance_status else 'exception_rejected'::attendance_status end,
         exception_reviewed_by = v_uid
  where id = p_attendance and status = 'exception_pending' returning * into v_rec;
  if not found then raise exception 'No pending exception for this record'; end if;
  perform write_audit(case when p_approve then 'approve_exception' else 'reject_exception' end, 'attendance_records', p_attendance::text,
                      jsonb_build_object('note', p_note));
  perform notify(v_rec.employee_id, 'attendance_exception_reviewed',
    case when p_approve then 'Clock-in exception approved' else 'Clock-in exception rejected' end, p_note, '/app/timesheets');
end $$;

-- ---------------------------------------------------------------------
-- Photos / checklist / issues (cleaner side)
-- ---------------------------------------------------------------------
create or replace function save_checklist_item(p_job uuid, p_task uuid, p_completed boolean, p_notes text default null,
                                               p_photo_path text default null)
returns checklist_submissions language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row checklist_submissions; v_job cleaning_jobs;
begin
  if not (is_assigned(p_job) or is_staff()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_job from cleaning_jobs where id = p_job;
  if v_job.status in ('completed','cancelled') and not is_staff() then raise exception 'This job is closed'; end if;
  if not exists (select 1 from checklist_tasks where id = p_task and checklist_id = v_job.checklist_id) then
    raise exception 'Task does not belong to this job''s checklist';
  end if;
  insert into checklist_submissions (job_id, task_id, employee_id, completed, notes, photo_path, completed_at)
  values (p_job, p_task, v_uid, p_completed, nullif(trim(p_notes), ''), p_photo_path, case when p_completed then now() end)
  on conflict (job_id, task_id) do update set
    completed = excluded.completed, employee_id = v_uid,
    notes = coalesce(excluded.notes, checklist_submissions.notes),
    photo_path = coalesce(excluded.photo_path, checklist_submissions.photo_path),
    completed_at = case when excluded.completed then coalesce(checklist_submissions.completed_at, now()) end,
    updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

create or replace function on_photo_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_title text;
begin
  select full_name into v_name from users where id = new.employee_id;
  select title into v_title from cleaning_jobs where id = new.job_id;
  perform notify_staff('photos', 'photos_uploaded', format('%s uploaded a %s photo', coalesce(v_name, 'Someone'), new.kind),
                       v_title, '/admin/jobs/' || new.job_id);
  return new;
end $$;
create trigger photo_notify after insert on job_photos for each row execute function on_photo_insert();

create or replace function report_issue(p_job uuid, p_category text, p_description text, p_photo_path text default null)
returns job_issues language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row job_issues; v_job cleaning_jobs; v_name text;
begin
  if not (is_assigned(p_job) or is_staff()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_job from cleaning_jobs where id = p_job;
  insert into job_issues (job_id, property_id, reported_by, source, category, description, photo_path)
  values (p_job, v_job.property_id, v_uid, case when is_staff() then 'quality_control' else 'cleaner' end,
          p_category, p_description, p_photo_path)
  returning * into v_row;
  select full_name into v_name from users where id = v_uid;
  perform notify_staff('issue', 'issue_reported', format('Issue reported by %s', v_name),
                       format('%s: %s', initcap(replace(p_category, '_', ' ')), left(p_description, 140)), '/admin/jobs/' || p_job);
  return v_row;
end $$;

-- Names of teammates on a job (cleaners can't read other users' rows directly)
create or replace function job_team(p_job uuid)
returns table (employee_id uuid, full_name text, is_team_lead boolean, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff() or is_assigned(p_job)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select a.employee_id, u.full_name, a.is_team_lead, a.status
  from job_assignments a join users u on u.id = a.employee_id where a.job_id = p_job order by a.is_team_lead desc, u.full_name;
end $$;

-- Self-service profile update (contact details only)
create or replace function update_my_profile(p_full_name text, p_phone text, p_address text,
                                             p_emergency_name text, p_emergency_phone text, p_email_notifications boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  update users set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''),
                   email_notifications = coalesce(p_email_notifications, true) where id = v_uid;
  update employee_profiles set address = nullif(trim(p_address), ''), emergency_contact_name = nullif(trim(p_emergency_name), ''),
                               emergency_contact_phone = nullif(trim(p_emergency_phone), '') where user_id = v_uid;
end $$;

-- ---------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------
create or replace function submit_timesheets(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_count int; v_name text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  update timesheets set status = 'submitted', submitted_at = now()
  where id = any(p_ids) and employee_id = v_uid and status in ('draft','rejected');
  get diagnostics v_count = row_count;
  if v_count > 0 then
    select full_name into v_name from users where id = v_uid;
    perform notify_staff('timesheet_submitted', 'timesheet_submitted', format('%s submitted %s timesheet entr%s', v_name, v_count,
      case when v_count = 1 then 'y' else 'ies' end), null, '/admin/timesheets?status=submitted');
  end if;
  return v_count;
end $$;

-- approve / reject (owner, ops manager) or mark under_review (any staff, i.e. office admin "prepares")
create or replace function review_timesheets(p_ids uuid[], p_action text, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager','office_admin']);
  v_new timesheet_status;
  v_count int;
  r record;
begin
  if p_action not in ('approve','reject','under_review') then raise exception 'Unknown action %', p_action; end if;
  if p_action in ('approve','reject') and not is_supervisor() then
    raise exception 'Only the owner or an operations manager can approve or reject timesheets' using errcode = '42501';
  end if;
  if p_action = 'reject' and coalesce(trim(p_notes), '') = '' then raise exception 'A reason is required to reject'; end if;
  v_new := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'under_review' end;

  -- unresolved GPS exceptions must be reviewed before approval
  if p_action = 'approve' and exists (
      select 1 from timesheets t join attendance_records a on a.id = t.attendance_id
      where t.id = any(p_ids) and a.status = 'exception_pending') then
    raise exception 'Resolve the pending attendance exception(s) before approving';
  end if;

  for r in update timesheets set status = v_new, reviewed_by = v_uid, reviewed_at = now(),
                                 review_notes = coalesce(nullif(trim(p_notes), ''), review_notes)
           where id = any(p_ids) and status in ('submitted','under_review','draft','rejected', 'approved')
             and not (status = 'approved' and v_new = 'under_review')
           returning id, employee_id, work_date, total_hours
  loop
    perform write_audit(p_action, 'timesheets', r.id::text, jsonb_build_object('notes', p_notes));
    if p_action <> 'under_review' then
      perform notify(r.employee_id, 'timesheet_' || v_new, format('Timesheet %s', v_new),
        format('%s · %s h%s', r.work_date, r.total_hours, coalesce(' — ' || p_notes, '')), '/app/timesheets');
    end if;
  end loop;
  get diagnostics v_count = row_count;
  return (select count(*) from timesheets where id = any(p_ids) and status = v_new);
end $$;

-- Manager edit with full audit trail (old/new values)
create or replace function manager_edit_timesheet(p_id uuid, p_clock_in timestamptz, p_clock_out timestamptz,
                                                  p_break int, p_reason text)
returns timesheets language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager','office_admin']);
  v_old timesheets;
  v_new timesheets;
  v_hours numeric;
begin
  select * into v_old from timesheets where id = p_id for update;
  if not found then raise exception 'Timesheet not found'; end if;
  if v_old.status = 'paid' then raise exception 'Paid timesheets cannot be edited'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for every edit'; end if;
  if p_clock_out <= p_clock_in then raise exception 'Clock-out must be after clock-in'; end if;
  v_hours := round(greatest(extract(epoch from (p_clock_out - p_clock_in)) / 60 - coalesce(p_break, 0), 0) / 60.0, 2);
  if v_hours > 24 then raise exception 'Shift cannot exceed 24 hours'; end if;

  update timesheets set clock_in_at = p_clock_in, clock_out_at = p_clock_out, break_minutes = coalesce(p_break, 0),
         total_hours = v_hours, estimated_earnings = round(v_hours * pay_rate, 2),
         work_date = (p_clock_in at time zone (settings()).timezone)::date,
         flags = (select array_agg(distinct f) from unnest(flags || array['manual_adjustment']) f),
         status = case when status = 'approved' then 'under_review'::timesheet_status else status end
  where id = p_id returning * into v_new;

  insert into timesheet_adjustments (timesheet_id, employee_id, requested_by, kind, old_values, new_values, reason, status, reviewed_by, reviewed_at)
  values (p_id, v_old.employee_id, v_uid, 'manager_edit',
          jsonb_build_object('clock_in_at', v_old.clock_in_at, 'clock_out_at', v_old.clock_out_at, 'break_minutes', v_old.break_minutes, 'total_hours', v_old.total_hours),
          jsonb_build_object('clock_in_at', p_clock_in, 'clock_out_at', p_clock_out, 'break_minutes', p_break, 'total_hours', v_hours),
          p_reason, 'approved', v_uid, now());
  perform write_audit('edit', 'timesheets', p_id::text, jsonb_build_object('reason', p_reason, 'old_hours', v_old.total_hours, 'new_hours', v_hours));
  perform notify(v_old.employee_id, 'timesheet_edited', 'A manager adjusted your timesheet',
                 format('%s: %s h → %s h. %s', v_old.work_date, v_old.total_hours, v_hours, p_reason), '/app/timesheets');
  return v_new;
end $$;

-- Cleaner requests a correction (wrong times) or a missed punch (forgot to clock in/out entirely)
create or replace function request_timesheet_correction(p_timesheet uuid, p_job uuid, p_clock_in timestamptz,
                                                        p_clock_out timestamptz, p_break int, p_reason text)
returns timesheet_adjustments language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row timesheet_adjustments; v_ts timesheets; v_name text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_clock_out <= p_clock_in then raise exception 'Clock-out must be after clock-in'; end if;
  if p_clock_out > now() + interval '5 minutes' then raise exception 'Times cannot be in the future'; end if;
  if extract(epoch from (p_clock_out - p_clock_in)) > 16 * 3600 then raise exception 'Shift cannot exceed 16 hours'; end if;
  if p_timesheet is not null then
    select * into v_ts from timesheets where id = p_timesheet and employee_id = v_uid;
    if not found then raise exception 'Timesheet not found'; end if;
    if v_ts.status in ('approved','paid') then raise exception 'Approved timesheets need a manager to edit them'; end if;
  elsif p_job is not null and not is_assigned(p_job) then
    raise exception 'You were not assigned to that job';
  end if;
  insert into timesheet_adjustments (timesheet_id, employee_id, requested_by, kind, job_id, old_values, new_values, reason)
  values (p_timesheet, v_uid, v_uid, case when p_timesheet is null then 'missed_punch_request' else 'correction_request' end,
          coalesce(p_job, v_ts.job_id),
          case when p_timesheet is not null then jsonb_build_object('clock_in_at', v_ts.clock_in_at, 'clock_out_at', v_ts.clock_out_at, 'break_minutes', v_ts.break_minutes) end,
          jsonb_build_object('clock_in_at', p_clock_in, 'clock_out_at', p_clock_out, 'break_minutes', coalesce(p_break, 0)),
          p_reason)
  returning * into v_row;
  select full_name into v_name from users where id = v_uid;
  perform notify_staff('timesheet_submitted', 'correction_requested', format('%s requested a timesheet correction', v_name),
                       p_reason, '/admin/timesheets?tab=corrections');
  return v_row;
end $$;

create or replace function review_correction(p_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager']);
  v_adj timesheet_adjustments;
  v_in timestamptz; v_out timestamptz; v_break int; v_hours numeric; v_rate numeric;
begin
  select * into v_adj from timesheet_adjustments where id = p_id and status = 'pending' for update;
  if not found then raise exception 'No pending request'; end if;
  update timesheet_adjustments set status = case when p_approve then 'approved'::request_status else 'rejected'::request_status end,
         reviewed_by = v_uid, reviewed_at = now(), review_notes = p_notes where id = p_id;
  if p_approve then
    v_in := (v_adj.new_values->>'clock_in_at')::timestamptz;
    v_out := (v_adj.new_values->>'clock_out_at')::timestamptz;
    v_break := coalesce((v_adj.new_values->>'break_minutes')::int, 0);
    v_hours := round(greatest(extract(epoch from (v_out - v_in)) / 60 - v_break, 0) / 60.0, 2);
    select pay_rate into v_rate from employee_profiles where user_id = v_adj.employee_id;
    if v_adj.timesheet_id is null then
      insert into timesheets (employee_id, job_id, work_date, clock_in_at, clock_out_at, break_minutes, total_hours, pay_rate,
                              estimated_earnings, status, flags, is_manual, employee_notes)
      values (v_adj.employee_id, v_adj.job_id, (v_in at time zone (settings()).timezone)::date, v_in, v_out, v_break, v_hours, v_rate,
              round(v_hours * v_rate, 2), 'submitted', array['manual_adjustment','missed_punch'], true, v_adj.reason);
    else
      update timesheets set clock_in_at = v_in, clock_out_at = v_out, break_minutes = v_break, total_hours = v_hours,
             estimated_earnings = round(v_hours * pay_rate, 2),
             flags = (select array_agg(distinct f) from unnest(flags || array['manual_adjustment']) f)
      where id = v_adj.timesheet_id;
    end if;
  end if;
  perform write_audit(case when p_approve then 'approve_correction' else 'reject_correction' end, 'timesheet_adjustments', p_id::text,
                      jsonb_build_object('notes', p_notes));
  perform notify(v_adj.employee_id, 'correction_reviewed',
                 case when p_approve then 'Timesheet correction approved' else 'Timesheet correction rejected' end, p_notes, '/app/timesheets');
end $$;

-- ---------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------
-- Period boundaries derived from the configured frequency & anchor
create or replace function period_for_date(p_date date)
returns table (start_date date, end_date date, pay_date date)
language plpgsql stable security definer set search_path = public as $$
declare v_s company_settings := settings(); v_days int; v_start date;
begin
  if v_s.pay_frequency in ('weekly','biweekly') then
    v_days := case when v_s.pay_frequency = 'weekly' then 7 else 14 end;
    v_start := v_s.pay_period_anchor + (floor((p_date - v_s.pay_period_anchor)::numeric / v_days) * v_days)::int;
    return query select v_start, v_start + v_days - 1, v_start + v_days - 1 + v_s.payday_offset_days;
  elsif v_s.pay_frequency = 'semimonthly' then
    if extract(day from p_date) <= 15 then
      return query select date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '14 days')::date,
                          (date_trunc('month', p_date) + interval '14 days')::date + v_s.payday_offset_days;
    else
      return query select (date_trunc('month', p_date) + interval '15 days')::date,
                          (date_trunc('month', p_date) + interval '1 month - 1 day')::date,
                          (date_trunc('month', p_date) + interval '1 month - 1 day')::date + v_s.payday_offset_days;
    end if;
  else
    return query select date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '1 month - 1 day')::date,
                        (date_trunc('month', p_date) + interval '1 month - 1 day')::date + v_s.payday_offset_days;
  end if;
end $$;

create or replace function ensure_payroll_period(p_date date)
returns payroll_periods language plpgsql security definer set search_path = public as $$
declare v_p payroll_periods; v_b record;
begin
  perform require_role(array['owner']);
  select * into v_b from period_for_date(p_date);
  insert into payroll_periods (start_date, end_date, pay_date) values (v_b.start_date, v_b.end_date, v_b.pay_date)
  on conflict (start_date, end_date) do nothing;
  select * into v_p from payroll_periods where start_date = v_b.start_date and end_date = v_b.end_date;
  return v_p;
end $$;

-- Core calculation. Overtime is applied ONLY when enabled in settings and the employee is eligible.
-- Daily threshold is applied first, then weekly threshold on the remaining regular hours (no double counting).
-- Deductions are applied ONLY when configured on the employee profile; net is otherwise left null (unknown).
create or replace function generate_payroll(p_period uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner']);
  v_s company_settings := settings();
  v_period payroll_periods;
  e record;
  d record;
  w record;
  v_daily_thr numeric; v_weekly_thr numeric; v_mult numeric;
  v_reg numeric; v_ot numeric; v_day_reg numeric;
  v_rate numeric; v_reg_pay numeric; v_ot_pay numeric; v_adj numeric; v_gross numeric;
  v_ded jsonb; v_ded_total numeric; v_item jsonb; v_amt numeric;
  v_neg numeric;
  v_pending numeric; v_count int; v_disc text[];
  v_record_id uuid;
  v_n int := 0;
begin
  select * into v_period from payroll_periods where id = p_period for update;
  if not found then raise exception 'Payroll period not found'; end if;
  if v_period.status in ('approved','paid') then raise exception 'Payroll for this period is already %', v_period.status; end if;

  -- release any timesheets previously attached to this period, then re-attach approved ones
  update timesheets set payroll_period_id = null where payroll_period_id = p_period and status = 'approved';
  update timesheets set payroll_period_id = p_period
  where status = 'approved' and work_date between v_period.start_date and v_period.end_date;

  for e in
    select u.id, u.full_name, ep.* from users u join employee_profiles ep on ep.user_id = u.id
    where exists (select 1 from timesheets t where t.employee_id = u.id and t.work_date between v_period.start_date and v_period.end_date
                    and t.status <> 'paid')
  loop
    v_mult := coalesce(e.overtime_multiplier, v_s.overtime_multiplier);
    v_daily_thr := coalesce(e.overtime_daily_threshold, v_s.overtime_daily_threshold);
    v_weekly_thr := coalesce(e.overtime_weekly_threshold, v_s.overtime_weekly_threshold);
    v_reg := 0; v_ot := 0;

    if v_s.overtime_enabled and e.overtime_eligible and e.employment_type <> 'contractor' then
      for w in
        select date_trunc('week', work_date)::date as wk from timesheets
        where employee_id = e.id and payroll_period_id = p_period group by 1
      loop
        v_day_reg := 0;
        for d in
          select work_date, sum(total_hours) h from timesheets
          where employee_id = e.id and payroll_period_id = p_period and date_trunc('week', work_date)::date = w.wk
          group by work_date
        loop
          if v_daily_thr is not null and d.h > v_daily_thr then
            v_ot := v_ot + (d.h - v_daily_thr);
            v_day_reg := v_day_reg + v_daily_thr;
          else
            v_day_reg := v_day_reg + d.h;
          end if;
        end loop;
        if v_weekly_thr is not null and v_day_reg > v_weekly_thr then
          v_ot := v_ot + (v_day_reg - v_weekly_thr);
          v_day_reg := v_weekly_thr;
        end if;
        v_reg := v_reg + v_day_reg;
      end loop;
    else
      select coalesce(sum(total_hours), 0) into v_reg from timesheets where employee_id = e.id and payroll_period_id = p_period;
    end if;

    -- rate: use the per-entry snapshot average so mid-period raises are honoured
    select coalesce(sum(total_hours * pay_rate) / nullif(sum(total_hours), 0), e.pay_rate), count(*)
      into v_rate, v_count
    from timesheets where employee_id = e.id and payroll_period_id = p_period;
    v_rate := round(v_rate, 2);
    v_reg_pay := round(v_reg * v_rate, 2);
    v_ot_pay := round(v_ot * v_rate * v_mult, 2);

    select coalesce(sum(total_hours), 0) into v_pending from timesheets
    where employee_id = e.id and work_date between v_period.start_date and v_period.end_date
      and status in ('draft','submitted','under_review','rejected');

    v_disc := '{}';
    if v_pending > 0 then v_disc := v_disc || format('%s h not yet approved', v_pending); end if;
    if e.pay_rate = 0 then v_disc := v_disc || 'Pay rate is $0 — set a rate on the employee profile'::text; end if;
    if exists (select 1 from timesheets where employee_id = e.id and payroll_period_id = p_period
               and flags && array['outside_geofence','gps_unavailable','unusually_long_shift','manual_adjustment']) then
      v_disc := v_disc || 'Includes flagged entries (geofence / GPS / manual / long shift)'::text;
    end if;

    insert into payroll_records (period_id, employee_id, regular_hours, overtime_hours, hourly_rate, overtime_multiplier,
                                 regular_pay, overtime_pay, pending_hours, timesheet_count, discrepancies, status)
    values (p_period, e.id, round(v_reg, 2), round(v_ot, 2), v_rate, v_mult, v_reg_pay, v_ot_pay, v_pending, v_count, v_disc, 'generated')
    on conflict (period_id, employee_id) do update set
      regular_hours = excluded.regular_hours, overtime_hours = excluded.overtime_hours, hourly_rate = excluded.hourly_rate,
      overtime_multiplier = excluded.overtime_multiplier, regular_pay = excluded.regular_pay, overtime_pay = excluded.overtime_pay,
      pending_hours = excluded.pending_hours, timesheet_count = excluded.timesheet_count, discrepancies = excluded.discrepancies,
      status = 'generated'
    returning id into v_record_id;

    -- positive adjustments (bonus, reimbursement, positive correction) add to gross; negative ones are deductions
    select coalesce(sum(amount) filter (where amount > 0), 0), coalesce(sum(amount) filter (where amount < 0), 0)
      into v_adj, v_neg
    from payroll_adjustments where payroll_record_id = v_record_id;
    v_gross := v_reg_pay + v_ot_pay + v_adj;

    -- configured deductions only
    v_ded := '[]'; v_ded_total := 0;
    for v_item in select * from jsonb_array_elements(coalesce(e.deductions, '[]'::jsonb)) loop
      v_amt := case when v_item->>'type' = 'percent'
                    then round(v_gross * (v_item->>'amount')::numeric / 100, 2)
                    else round((v_item->>'amount')::numeric, 2) end;
      v_ded := v_ded || jsonb_build_object('name', v_item->>'name', 'amount', v_amt);
      v_ded_total := v_ded_total + v_amt;
    end loop;
    if v_neg < 0 then
      v_ded := v_ded || jsonb_build_object('name', 'Payroll adjustments', 'amount', -v_neg);
      v_ded_total := v_ded_total - v_neg;
    end if;

    update payroll_records set adjustments_total = v_adj + v_neg, gross_pay = v_gross, deductions_total = v_ded_total,
           deductions_detail = v_ded,
           net_pay_estimate = case when jsonb_array_length(v_ded) > 0 then v_gross - v_ded_total end
    where id = v_record_id;
    v_n := v_n + 1;
  end loop;

  -- remove records for employees who no longer have hours in the period
  delete from payroll_records r where r.period_id = p_period and not exists (
    select 1 from timesheets t where t.employee_id = r.employee_id and t.work_date between v_period.start_date and v_period.end_date and t.status <> 'paid');

  update payroll_periods set status = 'generated', generated_at = now() where id = p_period;
  perform write_audit('generate', 'payroll_periods', p_period::text, jsonb_build_object('employees', v_n));
  return v_n;
end $$;

create or replace function add_payroll_adjustment(p_record uuid, p_kind text, p_description text, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner']); v_period uuid;
begin
  select period_id into v_period from payroll_records where id = p_record;
  if not found then raise exception 'Payroll record not found'; end if;
  if (select status from payroll_periods where id = v_period) in ('approved','paid') then raise exception 'Payroll is locked'; end if;
  insert into payroll_adjustments (payroll_record_id, kind, description, amount, created_by)
  values (p_record, p_kind, p_description, abs(p_amount) * case when p_kind = 'deduction' then -1 else 1 end, v_uid);
  perform generate_payroll(v_period);
end $$;

create or replace function approve_payroll(p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner']); r record;
begin
  update payroll_periods set status = 'approved', approved_by = v_uid, approved_at = now()
  where id = p_period and status = 'generated';
  if not found then raise exception 'Generate payroll before approving (or it is already approved)'; end if;
  update payroll_records set status = 'approved' where period_id = p_period;
  for r in select employee_id, gross_pay from payroll_records where period_id = p_period loop
    perform notify(r.employee_id, 'payroll_processed', 'Payroll processed',
                   format('Estimated gross pay: $%s. Actual net pay may differ.', r.gross_pay), '/app/earnings');
  end loop;
  perform write_audit('approve', 'payroll_periods', p_period::text, null);
end $$;

-- Only after money actually moved
create or replace function mark_payroll_paid(p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_role(array['owner']); r record;
begin
  update payroll_periods set status = 'paid', paid_at = now() where id = p_period and status = 'approved';
  if not found then raise exception 'Payroll must be approved before it can be marked paid'; end if;
  update payroll_records set status = 'paid' where period_id = p_period;
  update timesheets set status = 'paid' where payroll_period_id = p_period and status = 'approved';
  for r in select employee_id from payroll_records where period_id = p_period loop
    perform notify(r.employee_id, 'payroll_paid', 'Payment sent', 'Your pay for this period has been marked as paid.', '/app/earnings');
  end loop;
  perform write_audit('mark_paid', 'payroll_periods', p_period::text, null);
end $$;

-- ---------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------
create or replace function request_time_off(p_start date, p_end date, p_kind text, p_reason text)
returns time_off_requests language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row time_off_requests; v_name text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_end < p_start then raise exception 'End date must be on or after start date'; end if;
  if p_start < current_date - 30 then raise exception 'Start date is too far in the past'; end if;
  insert into time_off_requests (employee_id, start_date, end_date, kind, reason)
  values (v_uid, p_start, p_end, coalesce(p_kind, 'personal'), nullif(trim(p_reason), '')) returning * into v_row;
  select full_name into v_name from users where id = v_uid;
  perform notify_staff('time_off', 'time_off_requested', format('%s requested time off', v_name),
                       format('%s → %s', p_start, p_end), '/admin/time-off', array['owner','ops_manager']);
  return v_row;
end $$;

create or replace function cancel_time_off(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update time_off_requests set status = 'cancelled' where id = p_id and employee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Only your own pending requests can be cancelled'; end if;
end $$;

-- Approval marks affected jobs as needing attention so dispatch can reassign them
create or replace function review_time_off(p_id uuid, p_approve boolean, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := require_role(array['owner','ops_manager']);
  v_req time_off_requests;
  v_tz text := (settings()).timezone;
  v_affected int := 0;
begin
  update time_off_requests set status = case when p_approve then 'approved'::request_status else 'rejected'::request_status end,
         reviewed_by = v_uid, reviewed_at = now(), review_notes = p_notes
  where id = p_id and status = 'pending' returning * into v_req;
  if not found then raise exception 'No pending request found'; end if;
  if p_approve then
    update cleaning_jobs j set status = 'needs_attention'
    where j.status in ('scheduled','assigned','confirmed')
      and (j.scheduled_start at time zone v_tz)::date between v_req.start_date and v_req.end_date
      and exists (select 1 from job_assignments a where a.job_id = j.id and a.employee_id = v_req.employee_id);
    get diagnostics v_affected = row_count;
    if v_affected > 0 then
      perform notify_staff('schedule_change', 'reassignment_needed', format('%s job(s) need a replacement cleaner', v_affected),
                           'Approved time off overlaps scheduled jobs.', '/admin/schedule?status=needs_attention', array['owner','ops_manager','office_admin']);
    end if;
  end if;
  perform write_audit(case when p_approve then 'approve' else 'reject' end, 'time_off_requests', p_id::text,
                      jsonb_build_object('affected_jobs', v_affected));
  perform notify(v_req.employee_id, 'time_off_' || case when p_approve then 'approved' else 'rejected' end,
                 format('Time off %s', case when p_approve then 'approved' else 'rejected' end),
                 format('%s → %s%s', v_req.start_date, v_req.end_date, coalesce('. ' || p_notes, '')), '/app/time-off');
  return v_affected;
end $$;

-- ---------------------------------------------------------------------
-- Announcements → notifications
-- ---------------------------------------------------------------------
create or replace function on_announcement_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from users where is_active and (
      new.audience = 'all' or (new.audience = 'cleaners' and role_key = 'cleaner')
      or (new.audience = 'management' and role_key <> 'cleaner'))
  loop
    perform notify(r.id, 'announcement', new.title, left(new.body, 200),
                   case when (select role_key from users where id = r.id) = 'cleaner' then '/app' else '/admin/announcements' end);
  end loop;
  return new;
end $$;
create trigger announcement_notify after insert on announcements for each row execute function on_announcement_insert();

-- ---------------------------------------------------------------------
-- Scheduled checks (called every ~10 minutes by the cron route with the service role)
-- ---------------------------------------------------------------------
create or replace function run_attendance_checks()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s company_settings := settings();
  r record;
  v_missed int := 0;
  v_forgot int := 0;
begin
  -- missed clock-in
  for r in
    select a.id, a.employee_id, j.id job_id, j.title, u.full_name from job_assignments a
    join cleaning_jobs j on j.id = a.job_id join users u on u.id = a.employee_id
    where not a.missed_clock_in_alerted and j.status in ('scheduled','assigned','confirmed','in_progress')
      and now() > j.scheduled_start + make_interval(mins => v_s.missed_clock_in_minutes)
      and now() < j.scheduled_end + interval '12 hours'
      and not exists (select 1 from attendance_records ar where ar.job_id = j.id and ar.employee_id = a.employee_id)
  loop
    update job_assignments set missed_clock_in_alerted = true where id = r.id;
    perform notify(r.employee_id, 'missed_clock_in', 'You have not clocked in', r.title || ' has started. Clock in now or contact the office.', '/app/jobs/' || r.job_id);
    perform notify_staff('missed_clock_in', 'missed_clock_in', format('%s missed clock-in', r.full_name), r.title, '/admin/jobs/' || r.job_id);
    v_missed := v_missed + 1;
  end loop;

  -- forgot clock-out
  for r in
    select ar.id, ar.employee_id, ar.job_id, j.title, u.full_name from attendance_records ar
    join cleaning_jobs j on j.id = ar.job_id join users u on u.id = ar.employee_id
    where ar.clock_out_at is null and not ar.forgot_clock_out_alerted
      and (now() > j.scheduled_end + make_interval(mins => v_s.forgot_clock_out_minutes)
           or now() > ar.clock_in_at + make_interval(mins => (v_s.max_shift_hours * 60)::int))
  loop
    update attendance_records set forgot_clock_out_alerted = true, flags = flags || 'missing_clock_out'::text where id = r.id;
    perform notify(r.employee_id, 'forgot_clock_out', 'Did you forget to clock out?', r.title, '/app/jobs/' || r.job_id);
    perform notify_staff('forgot_clock_out', 'forgot_clock_out', format('%s has not clocked out', r.full_name), r.title,
                         '/admin/attendance?focus=' || r.id);
    v_forgot := v_forgot + 1;
  end loop;

  return jsonb_build_object('missed_clock_in', v_missed, 'forgot_clock_out', v_forgot);
end $$;

-- ---------------------------------------------------------------------
-- Generic audit trigger for important tables
-- ---------------------------------------------------------------------
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_details jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old)->>'id'); v_details := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_id := (to_jsonb(new)->>'id');
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)) into v_details
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if v_details is null then return new; end if;
  else
    v_id := (to_jsonb(new)->>'id'); v_details := jsonb_build_object('new', to_jsonb(new));
  end if;
  insert into audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_details);
  return coalesce(new, old);
end $$;

create trigger audit_users after insert or update or delete on users for each row execute function audit_row();
create trigger audit_profiles after update on employee_profiles for each row execute function audit_row();
create trigger audit_clients after insert or update or delete on clients for each row execute function audit_row();
create trigger audit_properties after insert or update or delete on properties for each row execute function audit_row();
create trigger audit_access_codes after insert or update or delete on property_access_codes for each row execute function audit_row();
create trigger audit_jobs after update or delete on cleaning_jobs for each row execute function audit_row();
create trigger audit_settings after update on company_settings for each row execute function audit_row();
create trigger audit_periods after update on payroll_periods for each row execute function audit_row();

-- ---------------------------------------------------------------------
-- Grants: RPCs callable by signed-in users only (each checks its own role)
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function run_attendance_checks() from authenticated;
-- internal helpers must not be callable from the browser
revoke execute on function notify(uuid, text, text, text, text) from authenticated;
revoke execute on function notify_staff(text, text, text, text, text, text[]) from authenticated;
revoke execute on function write_audit(text, text, text, jsonb) from authenticated;
