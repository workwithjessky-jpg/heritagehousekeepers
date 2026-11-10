-- =====================================================================
-- Migration 7: GoHighLevel (GHL) integration
--   * remember GHL ids so webhooks update records instead of duplicating them
--   * integration_events: log of every inbound webhook / outbound sync (owner-visible)
-- =====================================================================
alter table clients add column if not exists ghl_contact_id text;
create unique index if not exists clients_ghl_contact_idx on clients(ghl_contact_id) where ghl_contact_id is not null;
create index if not exists clients_email_idx on clients(lower(email));

alter table cleaning_jobs add column if not exists ghl_appointment_id text;
alter table cleaning_jobs add column if not exists source text not null default 'manual' check (source in ('manual','ghl'));
create unique index if not exists jobs_ghl_appointment_idx on cleaning_jobs(ghl_appointment_id) where ghl_appointment_id is not null;

create table if not exists integration_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'ghl',
  direction    text not null check (direction in ('in','out')),
  event        text not null,
  external_id  text,
  status       text not null default 'ok' check (status in ('ok','ignored','failed','pending')),
  message      text,
  client_id    uuid references clients(id) on delete set null,
  job_id       uuid references cleaning_jobs(id) on delete set null,
  payload      jsonb,
  attempts     int not null default 1,
  created_at   timestamptz not null default now()
);
create index if not exists integration_events_created_idx on integration_events(created_at desc);
create index if not exists integration_events_retry_idx on integration_events(status) where status in ('failed','pending');

alter table integration_events enable row level security;
-- Only the owner can read the log; writes come from the server (service role) only.
create policy integration_events_owner_read on integration_events for select to authenticated using (is_owner());
