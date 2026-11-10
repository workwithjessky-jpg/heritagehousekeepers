-- =====================================================================
-- Migration 10: phone push notifications (Web Push)
--   push_subscriptions — one row per phone/browser that tapped "Turn on phone alerts"
--   app_secrets        — server-only settings (VAPID keys, dispatch key/URL); no client access at all
--   Every new row in `notifications` for a user with a subscription is handed to
--   /api/push/dispatch (via pg_net), which sends the push. Failures never block the notification.
-- =====================================================================
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
create policy push_subs_own_read on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_subs_own_insert on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_subs_own_update on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subs_own_delete on push_subscriptions for delete to authenticated using (user_id = auth.uid());

create table if not exists app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security; -- no policies: only the service role can read it

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create or replace function on_notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from push_subscriptions where user_id = new.user_id) then return new; end if;
  select value into v_url from app_secrets where key = 'push_dispatch_url';
  select value into v_key from app_secrets where key = 'push_dispatch_key';
  if v_url is null or v_key is null then return new; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('notification_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', v_key),
      timeout_milliseconds := 5000
    );
  exception when others then
    null; -- a push problem must never stop the in-app notification
  end;
  return new;
end $$;

drop trigger if exists notification_push on notifications;
create trigger notification_push after insert on notifications for each row execute function on_notification_push();
revoke execute on function on_notification_push() from public, anon, authenticated;
