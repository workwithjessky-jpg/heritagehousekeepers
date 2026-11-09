-- =====================================================================
-- Migration 2: role helpers, user provisioning, guards, row-level security
-- =====================================================================

insert into employee_roles (key, name, description, permissions) values
  ('owner',        'Super Admin / Owner',    'Full access, payroll, settings and audit logs',
     '{"employees":"manage","pay_rates":"manage","clients":"manage","jobs":"manage","timesheets":"approve","payroll":"manage","reports":true,"settings":true,"audit":true}'),
  ('ops_manager',  'Operations Manager',     'Scheduling, dispatch, timesheet review, payroll estimates',
     '{"employees":"view","pay_rates":"view","clients":"manage","jobs":"manage","timesheets":"approve","payroll":"view","reports":true,"settings":false,"audit":false}'),
  ('office_admin', 'Office Administrator',   'Clients, appointments, attendance review, timesheet preparation',
     '{"employees":"view","pay_rates":"none","clients":"manage","jobs":"manage","timesheets":"prepare","payroll":"none","reports":false,"settings":false,"audit":false}'),
  ('cleaner',      'Cleaner / Employee',     'Own schedule, attendance, timesheets and earnings only',
     '{"self_service":true}');

-- ---------------------------------------------------------------------
-- Role helper functions (SECURITY DEFINER so they can read users without recursion)
-- ---------------------------------------------------------------------
create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role_key from users where id = auth.uid() and is_active
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('owner','ops_manager','office_admin'), false)
$$;

create or replace function is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('owner','ops_manager'), false)
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'owner', false)
$$;

create or replace function is_assigned(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_assignments where job_id = p_job and employee_id = auth.uid())
$$;

create or replace function cleaner_can_see_property(p_property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from job_assignments a join cleaning_jobs j on j.id = a.job_id
    where a.employee_id = auth.uid() and j.property_id = p_property)
$$;

create or replace function cleaner_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from job_assignments a join cleaning_jobs j on j.id = a.job_id
    where a.employee_id = auth.uid() and j.client_id = p_client)
$$;

-- Entry codes are only revealed close to an active assignment.
create or replace function cleaner_can_see_access_code(p_property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from job_assignments a join cleaning_jobs j on j.id = a.job_id
    where a.employee_id = auth.uid() and j.property_id = p_property
      and j.status not in ('cancelled','completed')
      and j.scheduled_start between now() - interval '12 hours' and now() + interval '24 hours')
$$;

-- ---------------------------------------------------------------------
-- Provisioning: a public.users row is created for every auth user.
-- Role comes from app_metadata (only settable with the service role key),
-- never from user-editable user_metadata.
-- ---------------------------------------------------------------------
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_app_meta_data->>'role', 'cleaner');
begin
  if v_role not in ('owner','ops_manager','office_admin','cleaner') then
    v_role := 'cleaner';
  end if;
  insert into users (id, email, full_name, role_key, phone)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
          v_role, new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  insert into employee_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Guards: column-level protections RLS cannot express
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger users_touch before update on users for each row execute function touch_updated_at();
create trigger profiles_touch before update on employee_profiles for each row execute function touch_updated_at();
create trigger clients_touch before update on clients for each row execute function touch_updated_at();
create trigger properties_touch before update on properties for each row execute function touch_updated_at();
create trigger jobs_touch before update on cleaning_jobs for each row execute function touch_updated_at();
create trigger timesheets_touch before update on timesheets for each row execute function touch_updated_at();
create trigger payroll_records_touch before update on payroll_records for each row execute function touch_updated_at();

create or replace function guard_users_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- service role / migrations
  if (new.role_key is distinct from old.role_key or new.is_active is distinct from old.is_active
      or new.email is distinct from old.email) and not is_owner() then
    raise exception 'Only the owner can change roles, email or account status' using errcode = '42501';
  end if;
  if new.id = auth.uid() and new.role_key <> 'owner' and old.role_key = 'owner'
     and not exists (select 1 from users where role_key = 'owner' and is_active and id <> new.id) then
    raise exception 'At least one active owner is required' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger users_guard before update on users for each row execute function guard_users_update();

create or replace function guard_profile_pay_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.pay_rate, new.employment_type, new.pay_frequency, new.overtime_eligible,
      new.overtime_weekly_threshold, new.overtime_daily_threshold, new.overtime_multiplier, new.deductions)
     is distinct from
     (old.pay_rate, old.employment_type, old.pay_frequency, old.overtime_eligible,
      old.overtime_weekly_threshold, old.overtime_daily_threshold, old.overtime_multiplier, old.deductions)
     and not is_owner() then
    raise exception 'Only the owner can change compensation settings' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_pay_guard before update on employee_profiles for each row execute function guard_profile_pay_fields();

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','employee_roles','users','employee_profiles','employee_performance_notes',
    'clients','properties','property_access_codes','cleaning_checklists','checklist_tasks',
    'cleaning_jobs','job_assignments','employee_availability','attendance_records','gps_locations',
    'payroll_periods','timesheets','timesheet_adjustments','payroll_records','payroll_adjustments',
    'checklist_submissions','job_photos','job_issues','time_off_requests','employee_documents',
    'notifications','notification_deliveries','announcements','audit_logs']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- company_settings / roles: everyone signed in can read; owner edits
create policy settings_read on company_settings for select to authenticated using (true);
create policy settings_write on company_settings for update to authenticated using (is_owner()) with check (is_owner());
create policy roles_read on employee_roles for select to authenticated using (true);
create policy roles_write on employee_roles for update to authenticated using (is_owner()) with check (is_owner());

-- users
create policy users_read on users for select to authenticated using (id = auth.uid() or is_staff());
create policy users_update on users for update to authenticated
  using (id = auth.uid() or is_owner() or (is_staff() and role_key = 'cleaner'))
  with check (id = auth.uid() or is_owner() or (is_staff() and role_key = 'cleaner'));

-- employee profiles (personal info + compensation)
create policy profiles_read on employee_profiles for select to authenticated using (user_id = auth.uid() or is_staff());
create policy profiles_update on employee_profiles for update to authenticated using (is_staff()) with check (is_staff());

create policy perf_notes_all on employee_performance_notes for all to authenticated
  using (is_supervisor()) with check (is_supervisor());

-- clients & properties
create policy clients_staff on clients for all to authenticated using (is_staff()) with check (is_staff());
create policy clients_cleaner_read on clients for select to authenticated using (cleaner_can_see_client(id));
create policy properties_staff on properties for all to authenticated using (is_staff()) with check (is_staff());
create policy properties_cleaner_read on properties for select to authenticated using (cleaner_can_see_property(id));
create policy access_codes_supervisor on property_access_codes for all to authenticated using (is_supervisor()) with check (is_supervisor());
create policy access_codes_office_read on property_access_codes for select to authenticated using (is_staff());
create policy access_codes_cleaner_read on property_access_codes for select to authenticated using (cleaner_can_see_access_code(property_id));

-- checklists
create policy checklists_read on cleaning_checklists for select to authenticated using (true);
create policy checklists_write on cleaning_checklists for all to authenticated using (is_supervisor()) with check (is_supervisor());
create policy checklist_tasks_read on checklist_tasks for select to authenticated using (true);
create policy checklist_tasks_write on checklist_tasks for all to authenticated using (is_supervisor()) with check (is_supervisor());

-- jobs & assignments (cleaner writes go through RPCs)
create policy jobs_staff on cleaning_jobs for all to authenticated using (is_staff()) with check (is_staff());
create policy jobs_cleaner_read on cleaning_jobs for select to authenticated using (is_assigned(id));
create policy assignments_staff on job_assignments for all to authenticated using (is_staff()) with check (is_staff());
create policy assignments_own_read on job_assignments for select to authenticated using (employee_id = auth.uid());

-- availability
create policy availability_own on employee_availability for all to authenticated
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
create policy availability_staff on employee_availability for all to authenticated using (is_staff()) with check (is_staff());

-- attendance & gps (inserts only via clock_in / clock_out RPCs)
create policy attendance_own_read on attendance_records for select to authenticated using (employee_id = auth.uid());
create policy attendance_staff_read on attendance_records for select to authenticated using (is_staff());
create policy gps_own_read on gps_locations for select to authenticated using (employee_id = auth.uid());
create policy gps_staff_read on gps_locations for select to authenticated using (is_staff());

-- timesheets (writes only via RPCs so every change is validated + audited)
create policy timesheets_own_read on timesheets for select to authenticated using (employee_id = auth.uid());
create policy timesheets_staff_read on timesheets for select to authenticated using (is_staff());
create policy ts_adjust_own_read on timesheet_adjustments for select to authenticated using (employee_id = auth.uid());
create policy ts_adjust_staff_read on timesheet_adjustments for select to authenticated using (is_staff());

-- payroll: owner manages, ops manager views estimates, employee sees own
create policy periods_read on payroll_periods for select to authenticated using (true);
create policy periods_owner on payroll_periods for all to authenticated using (is_owner()) with check (is_owner());
create policy payroll_own_read on payroll_records for select to authenticated using (employee_id = auth.uid());
create policy payroll_supervisor_read on payroll_records for select to authenticated using (is_supervisor());
create policy payroll_adj_owner on payroll_adjustments for all to authenticated using (is_owner()) with check (is_owner());
create policy payroll_adj_read on payroll_adjustments for select to authenticated using (
  is_supervisor() or exists (select 1 from payroll_records r where r.id = payroll_record_id and r.employee_id = auth.uid()));

-- checklist execution
create policy submissions_staff on checklist_submissions for all to authenticated using (is_staff()) with check (is_staff());
create policy submissions_cleaner_read on checklist_submissions for select to authenticated using (is_assigned(job_id));

-- photos & issues
create policy photos_staff on job_photos for all to authenticated using (is_staff()) with check (is_staff());
create policy photos_cleaner_read on job_photos for select to authenticated using (is_assigned(job_id));
create policy photos_cleaner_insert on job_photos for insert to authenticated
  with check (employee_id = auth.uid() and is_assigned(job_id) and storage_path like job_id::text || '/%');
create policy issues_staff on job_issues for all to authenticated using (is_staff()) with check (is_staff());
create policy issues_own_read on job_issues for select to authenticated using (reported_by = auth.uid());

-- time off
create policy tor_own_read on time_off_requests for select to authenticated using (employee_id = auth.uid());
create policy tor_staff_read on time_off_requests for select to authenticated using (is_staff());

-- documents
create policy docs_own_read on employee_documents for select to authenticated using (employee_id = auth.uid());
create policy docs_staff on employee_documents for all to authenticated using (is_staff()) with check (is_staff());

-- notifications
create policy notifications_own_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on notifications for delete to authenticated using (user_id = auth.uid());
-- notification_deliveries: no policies => only the service role (cron worker) can touch it.

-- announcements
create policy announcements_read on announcements for select to authenticated using (
  is_staff() or audience in ('all','cleaners'));
create policy announcements_write on announcements for all to authenticated using (is_staff()) with check (is_staff());

-- audit
create policy audit_owner_read on audit_logs for select to authenticated using (is_owner());

-- Realtime for in-app notifications & live ops board (skipped where publication doesn't exist)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications, attendance_records, cleaning_jobs;
  end if;
end $$;
