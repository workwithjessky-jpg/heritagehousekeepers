-- =====================================================================
-- Heritage Housekeepers | Operations Hub
-- Migration 1: core schema (tables, constraints, indexes)
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------
create type job_status as enum (
  'scheduled', 'assigned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'needs_attention'
);
create type timesheet_status as enum (
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'paid'
);
create type attendance_status as enum (
  'clocked_in', 'clocked_out', 'exception_pending', 'exception_approved', 'exception_rejected'
);
create type location_status as enum ('verified', 'outside_geofence', 'unavailable', 'no_property_coordinates');
create type request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type payroll_status as enum ('open', 'generated', 'approved', 'paid');

-- ---------------------------------------------------------------------
-- Company settings (single row). Every business rule lives here.
-- ---------------------------------------------------------------------
create table company_settings (
  id                          int primary key default 1 check (id = 1),
  company_name                text not null default 'Heritage Housekeepers',
  company_email               text,
  company_phone               text,
  company_address             text,
  timezone                    text not null default 'America/New_York',
  currency                    text not null default 'USD',
  jurisdiction                text not null default 'Not configured',
  -- Payroll
  pay_frequency               text not null default 'biweekly' check (pay_frequency in ('weekly','biweekly','semimonthly','monthly')),
  pay_period_anchor           date not null default date '2026-01-05',
  payday_offset_days          int  not null default 5 check (payday_offset_days between 0 and 31),
  overtime_enabled            boolean not null default false,
  overtime_weekly_threshold   numeric(5,2) check (overtime_weekly_threshold > 0),
  overtime_daily_threshold    numeric(5,2) check (overtime_daily_threshold > 0),
  overtime_multiplier         numeric(4,2) not null default 1.5 check (overtime_multiplier >= 1),
  -- Breaks
  auto_break_enabled          boolean not null default false,
  auto_break_after_hours      numeric(4,2) not null default 6 check (auto_break_after_hours > 0),
  auto_break_minutes          int not null default 30 check (auto_break_minutes between 0 and 240),
  -- Attendance
  default_geofence_m          int not null default 150 check (default_geofence_m between 10 and 5000),
  require_gps_for_clock_in    boolean not null default true,
  late_grace_minutes          int not null default 10 check (late_grace_minutes >= 0),
  missed_clock_in_minutes     int not null default 20 check (missed_clock_in_minutes > 0),
  forgot_clock_out_minutes    int not null default 60 check (forgot_clock_out_minutes > 0),
  max_shift_hours             numeric(4,2) not null default 10 check (max_shift_hours > 0),
  max_weekly_hours_alert      numeric(5,2) not null default 45 check (max_weekly_hours_alert > 0),
  min_travel_buffer_minutes   int not null default 20 check (min_travel_buffer_minutes >= 0),
  avg_travel_speed_kmh        numeric(5,1) not null default 35 check (avg_travel_speed_kmh > 0),
  -- Quality
  require_before_after_photos boolean not null default true,
  -- Catalogs (configurable lists)
  job_types                   jsonb not null default '["Standard Residential","Deep Clean","Move-In","Move-Out","Recurring Maintenance","Post-Construction"]',
  service_pricing             jsonb not null default '[]',
  operating_hours             jsonb not null default '{"mon":["08:00","18:00"],"tue":["08:00","18:00"],"wed":["08:00","18:00"],"thu":["08:00","18:00"],"fri":["08:00","18:00"],"sat":["09:00","14:00"],"sun":null}',
  notification_prefs          jsonb not null default '{"email_enabled":false,"events":{"clock_in":true,"clock_out":true,"geofence":true,"missed_clock_in":true,"forgot_clock_out":true,"timesheet_submitted":true,"time_off":true,"issue":true,"job_completed":true,"photos":false,"schedule_change":true}}',
  location_policy_text        text not null default 'Heritage Housekeepers records your GPS location only at the moment you clock in and clock out of a scheduled job, to verify you are at the assigned property. Location is never tracked outside an active work session.',
  updated_at                  timestamptz not null default now()
);
insert into company_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Roles & users
-- ---------------------------------------------------------------------
create table employee_roles (
  key          text primary key check (key in ('owner','ops_manager','office_admin','cleaner')),
  name         text not null,
  description  text,
  permissions  jsonb not null default '{}'
);

create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text,
  role_key    text not null default 'cleaner' references employee_roles(key),
  avatar_url  text,
  is_active   boolean not null default true,
  email_notifications boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index users_role_idx on users(role_key) where is_active;

create table employee_profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references users(id) on delete cascade,
  employee_number          text unique,
  job_title                text not null default 'Housekeeper',
  employment_type          text not null default 'hourly_employee'
                             check (employment_type in ('hourly_employee','part_time','salaried','contractor','seasonal')),
  employment_status        text not null default 'active'
                             check (employment_status in ('onboarding','active','on_leave','inactive','terminated')),
  hire_date                date,
  pay_rate                 numeric(8,2) not null default 0 check (pay_rate >= 0),
  pay_frequency            text check (pay_frequency in ('weekly','biweekly','semimonthly','monthly')),
  overtime_eligible        boolean not null default true,
  overtime_weekly_threshold numeric(5,2),
  overtime_daily_threshold  numeric(5,2),
  overtime_multiplier      numeric(4,2),
  -- deductions: [{"name":"Uniform","type":"fixed"|"percent","amount":10}]. Only applied if explicitly configured.
  deductions               jsonb not null default '[]',
  team                     text,
  address                  text,
  home_latitude            double precision check (home_latitude between -90 and 90),
  home_longitude           double precision check (home_longitude between -180 and 180),
  emergency_contact_name   text,
  emergency_contact_phone  text,
  onboarding_checklist     jsonb not null default '[{"item":"Signed employment agreement","done":false},{"item":"Tax forms received","done":false},{"item":"ID verified","done":false},{"item":"Safety & chemical training","done":false},{"item":"Location policy acknowledged","done":false},{"item":"Uniform & supplies issued","done":false}]',
  training_records         jsonb not null default '[]',
  certifications           jsonb not null default '[]',
  location_consent_at      timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index employee_profiles_team_idx on employee_profiles(team);

create table employee_performance_notes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references users(id) on delete cascade,
  author_id   uuid references users(id) on delete set null,
  rating      int check (rating between 1 and 5),
  note        text not null,
  created_at  timestamptz not null default now()
);
create index perf_notes_employee_idx on employee_performance_notes(employee_id, created_at desc);

-- ---------------------------------------------------------------------
-- Clients & properties
-- ---------------------------------------------------------------------
create table clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  email           text,
  phone           text,
  billing_address text,
  status          text not null default 'active' check (status in ('lead','active','paused','inactive')),
  notes           text,
  is_demo         boolean not null default false,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index clients_status_idx on clients(status);
create index clients_name_idx on clients(lower(name));

create table properties (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  name                 text not null,
  address              text not null,
  latitude             double precision check (latitude between -90 and 90),
  longitude            double precision check (longitude between -180 and 180),
  geofence_radius_m    int check (geofence_radius_m between 10 and 5000),
  access_instructions  text,
  cleaning_type        text,
  square_feet          int check (square_feet >= 0),
  bedrooms             numeric(3,1) check (bedrooms >= 0),
  bathrooms            numeric(3,1) check (bathrooms >= 0),
  special_instructions text,
  assigned_team        text,
  recurring_frequency  text not null default 'none' check (recurring_frequency in ('none','weekly','biweekly','monthly')),
  is_active            boolean not null default true,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index properties_client_idx on properties(client_id);

-- Restricted: lockbox / alarm / entry codes live in their own table with tighter RLS.
create table property_access_codes (
  property_id  uuid primary key references properties(id) on delete cascade,
  entry_code   text,
  lockbox_code text,
  alarm_code   text,
  notes        text,
  updated_by   uuid references users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Checklist templates
-- ---------------------------------------------------------------------
create table cleaning_checklists (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cleaning_type text not null,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table checklist_tasks (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references cleaning_checklists(id) on delete cascade,
  area           text not null,
  task           text not null,
  sort_order     int not null default 0,
  is_required    boolean not null default true,
  requires_photo boolean not null default false
);
create index checklist_tasks_checklist_idx on checklist_tasks(checklist_id, sort_order);

-- ---------------------------------------------------------------------
-- Jobs & assignments
-- ---------------------------------------------------------------------
create table cleaning_jobs (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete restrict,
  property_id          uuid not null references properties(id) on delete restrict,
  checklist_id         uuid references cleaning_checklists(id) on delete set null,
  title                text not null,
  cleaning_type        text not null,
  scheduled_start      timestamptz not null,
  scheduled_end        timestamptz not null,
  status               job_status not null default 'scheduled',
  price                numeric(10,2) check (price >= 0),
  instructions         text,
  recurrence_rule      text not null default 'none' check (recurrence_rule in ('none','weekly','biweekly','monthly')),
  recurrence_group_id  uuid,
  parent_job_id        uuid references cleaning_jobs(id) on delete set null,
  cancelled_reason     text,
  completed_at         timestamptz,
  completion_exception text,
  quality_status       text not null default 'pending' check (quality_status in ('pending','passed','flagged')),
  quality_notes        text,
  client_feedback      text,
  client_rating        int check (client_rating between 1 and 5),
  is_demo              boolean not null default false,
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint job_time_order check (scheduled_end > scheduled_start),
  constraint job_max_length check (scheduled_end - scheduled_start <= interval '16 hours')
);
create index jobs_start_idx on cleaning_jobs(scheduled_start);
create index jobs_status_idx on cleaning_jobs(status);
create index jobs_property_idx on cleaning_jobs(property_id, scheduled_start desc);
create index jobs_client_idx on cleaning_jobs(client_id);
create index jobs_recurrence_idx on cleaning_jobs(recurrence_group_id);

create table job_assignments (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references cleaning_jobs(id) on delete cascade,
  employee_id             uuid not null references users(id) on delete cascade,
  is_team_lead            boolean not null default false,
  status                  text not null default 'assigned' check (status in ('assigned','confirmed','declined')),
  missed_clock_in_alerted boolean not null default false,
  assigned_by             uuid references users(id) on delete set null,
  created_at              timestamptz not null default now(),
  unique (job_id, employee_id)
);
create index assignments_employee_idx on job_assignments(employee_id);

create table employee_availability (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references users(id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint availability_order check (end_time > start_time)
);
create index availability_employee_idx on employee_availability(employee_id, weekday);

-- ---------------------------------------------------------------------
-- Attendance & GPS
-- ---------------------------------------------------------------------
create table attendance_records (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null references cleaning_jobs(id) on delete restrict,
  employee_id            uuid not null references users(id) on delete restrict,
  clock_in_at            timestamptz not null default now(),
  clock_out_at           timestamptz,
  clock_in_latitude      double precision,
  clock_in_longitude     double precision,
  clock_in_accuracy_m    double precision,
  clock_in_distance_m    double precision,
  clock_in_location      location_status not null,
  clock_out_latitude     double precision,
  clock_out_longitude    double precision,
  clock_out_accuracy_m   double precision,
  clock_out_distance_m   double precision,
  clock_out_location     location_status,
  geofence_radius_m      int not null,
  break_minutes          int not null default 0 check (break_minutes between 0 and 600),
  total_minutes          int,
  status                 attendance_status not null default 'clocked_in',
  exception_reason       text,
  exception_reviewed_by  uuid references users(id) on delete set null,
  flags                  text[] not null default '{}',
  forgot_clock_out_alerted boolean not null default false,
  created_at             timestamptz not null default now(),
  constraint attendance_order check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create index attendance_employee_idx on attendance_records(employee_id, clock_in_at desc);
create index attendance_job_idx on attendance_records(job_id);
create unique index attendance_one_open_per_employee on attendance_records(employee_id) where clock_out_at is null;

create table gps_locations (
  id               uuid primary key default gen_random_uuid(),
  attendance_id    uuid not null references attendance_records(id) on delete cascade,
  employee_id      uuid not null references users(id) on delete cascade,
  event            text not null check (event in ('clock_in','clock_out')),
  latitude         double precision check (latitude between -90 and 90),
  longitude        double precision check (longitude between -180 and 180),
  accuracy_m       double precision,
  distance_m       double precision,
  within_geofence  boolean,
  recorded_at      timestamptz not null default now()
);
create index gps_attendance_idx on gps_locations(attendance_id);

-- ---------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------
create table payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  start_date   date not null,
  end_date     date not null,
  pay_date     date,
  status       payroll_status not null default 'open',
  generated_at timestamptz,
  approved_by  uuid references users(id) on delete set null,
  approved_at  timestamptz,
  paid_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  constraint period_order check (end_date >= start_date),
  unique (start_date, end_date)
);

create table timesheets (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references users(id) on delete restrict,
  attendance_id      uuid unique references attendance_records(id) on delete set null,
  job_id             uuid references cleaning_jobs(id) on delete set null,
  work_date          date not null,
  clock_in_at        timestamptz not null,
  clock_out_at       timestamptz not null,
  break_minutes      int not null default 0 check (break_minutes between 0 and 600),
  total_hours        numeric(6,2) not null check (total_hours >= 0 and total_hours <= 24),
  pay_rate           numeric(8,2) not null default 0,
  estimated_earnings numeric(10,2) not null default 0,
  status             timesheet_status not null default 'draft',
  flags              text[] not null default '{}',
  is_manual          boolean not null default false,
  employee_notes     text,
  review_notes       text,
  submitted_at       timestamptz,
  reviewed_by        uuid references users(id) on delete set null,
  reviewed_at        timestamptz,
  payroll_period_id  uuid references payroll_periods(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ts_order check (clock_out_at > clock_in_at)
);
create index timesheets_employee_idx on timesheets(employee_id, work_date desc);
create index timesheets_status_idx on timesheets(status, work_date);

create table timesheet_adjustments (
  id            uuid primary key default gen_random_uuid(),
  timesheet_id  uuid references timesheets(id) on delete cascade,
  employee_id   uuid not null references users(id) on delete cascade,
  requested_by  uuid not null references users(id) on delete cascade,
  kind          text not null check (kind in ('correction_request','missed_punch_request','manager_edit')),
  job_id        uuid references cleaning_jobs(id) on delete set null,
  old_values    jsonb,
  new_values    jsonb not null,
  reason        text not null check (length(trim(reason)) >= 3),
  status        request_status not null default 'pending',
  reviewed_by   uuid references users(id) on delete set null,
  reviewed_at   timestamptz,
  review_notes  text,
  created_at    timestamptz not null default now()
);
create index ts_adjust_status_idx on timesheet_adjustments(status, created_at desc);

-- ---------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------
create table payroll_records (
  id                 uuid primary key default gen_random_uuid(),
  period_id          uuid not null references payroll_periods(id) on delete cascade,
  employee_id        uuid not null references users(id) on delete restrict,
  regular_hours      numeric(7,2) not null default 0,
  overtime_hours     numeric(7,2) not null default 0,
  hourly_rate        numeric(8,2) not null default 0,
  overtime_multiplier numeric(4,2) not null default 1,
  regular_pay        numeric(10,2) not null default 0,
  overtime_pay       numeric(10,2) not null default 0,
  adjustments_total  numeric(10,2) not null default 0,
  gross_pay          numeric(10,2) not null default 0,
  deductions_total   numeric(10,2) not null default 0,
  deductions_detail  jsonb not null default '[]',
  net_pay_estimate   numeric(10,2),
  pending_hours      numeric(7,2) not null default 0,
  timesheet_count    int not null default 0,
  discrepancies      text[] not null default '{}',
  status             payroll_status not null default 'generated',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index payroll_records_employee_idx on payroll_records(employee_id);

create table payroll_adjustments (
  id                uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null references payroll_records(id) on delete cascade,
  kind              text not null check (kind in ('bonus','reimbursement','deduction','correction')),
  description       text not null,
  amount            numeric(10,2) not null,
  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Checklist execution, photos, issues
-- ---------------------------------------------------------------------
create table checklist_submissions (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references cleaning_jobs(id) on delete cascade,
  task_id      uuid not null references checklist_tasks(id) on delete cascade,
  employee_id  uuid references users(id) on delete set null,
  completed    boolean not null default false,
  notes        text,
  photo_path   text,
  completed_at timestamptz,
  flagged      boolean not null default false,
  flag_note    text,
  updated_at   timestamptz not null default now(),
  unique (job_id, task_id)
);

create table job_photos (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references cleaning_jobs(id) on delete cascade,
  employee_id  uuid references users(id) on delete set null,
  kind         text not null check (kind in ('before','after','issue','checklist')),
  storage_path text not null,
  caption      text,
  created_at   timestamptz not null default now()
);
create index job_photos_job_idx on job_photos(job_id);

create table job_issues (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references cleaning_jobs(id) on delete set null,
  property_id  uuid not null references properties(id) on delete cascade,
  reported_by  uuid references users(id) on delete set null,
  source       text not null default 'cleaner' check (source in ('cleaner','quality_control','client')),
  category     text not null check (category in ('damage','access','supplies','safety','quality','client_request','other')),
  description  text not null check (length(trim(description)) >= 3),
  photo_path   text,
  status       text not null default 'open' check (status in ('open','in_progress','resolved')),
  resolution   text,
  resolved_by  uuid references users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index job_issues_property_idx on job_issues(property_id, created_at desc);
create index job_issues_status_idx on job_issues(status);

-- ---------------------------------------------------------------------
-- HR: time off, documents
-- ---------------------------------------------------------------------
create table time_off_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references users(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  kind         text not null default 'personal' check (kind in ('vacation','sick','personal','unpaid','other')),
  reason       text,
  status       request_status not null default 'pending',
  reviewed_by  uuid references users(id) on delete set null,
  reviewed_at  timestamptz,
  review_notes text,
  created_at   timestamptz not null default now(),
  constraint tor_order check (end_date >= start_date)
);
create index tor_employee_idx on time_off_requests(employee_id, start_date);

create table employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references users(id) on delete cascade,
  name         text not null,
  category     text not null default 'other' check (category in ('contract','identification','tax','certification','training','policy','other')),
  storage_path text not null,
  expires_on   date,
  uploaded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);
create index notifications_unread_idx on notifications(user_id) where read_at is null;

-- Outbox for external channels. Email today; sms / whatsapp later.
create table notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  channel         text not null check (channel in ('email','sms','whatsapp')),
  destination     text not null,
  status          text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts        int not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index deliveries_queue_idx on notification_deliveries(status, created_at) where status = 'queued';

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  audience     text not null default 'all' check (audience in ('all','cleaners','management')),
  pinned       boolean not null default false,
  created_by   uuid references users(id) on delete set null,
  published_at timestamptz not null default now()
);

create table audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on audit_logs(entity, entity_id);
create index audit_created_idx on audit_logs(created_at desc);
