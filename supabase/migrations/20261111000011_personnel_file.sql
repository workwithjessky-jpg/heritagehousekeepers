-- =====================================================================
-- Migration 11: personnel file — everything about an employee in one spot
--   mailing address, emergency contact relationship, background check status/date,
--   and document types for driver's license, background check report and résumé.
-- =====================================================================
alter table employee_profiles add column if not exists mailing_address text;
alter table employee_profiles add column if not exists emergency_contact_relationship text;
alter table employee_profiles add column if not exists background_check_status text not null default 'not_started';
alter table employee_profiles drop constraint if exists employee_profiles_background_check_status_check;
alter table employee_profiles add constraint employee_profiles_background_check_status_check
  check (background_check_status in ('not_started', 'in_progress', 'clear', 'needs_review', 'not_cleared'));
alter table employee_profiles add column if not exists background_check_date date;

alter table employee_documents drop constraint if exists employee_documents_category_check;
alter table employee_documents add constraint employee_documents_category_check
  check (category in ('drivers_license', 'background_check', 'resume', 'contract', 'identification', 'tax',
                      'certification', 'training', 'policy', 'other'));

-- Cleaners keep their own contact details current (mailing address + emergency contact relationship added).
drop function if exists update_my_profile(text, text, text, text, text, boolean);
create or replace function update_my_profile(p_full_name text, p_phone text, p_address text,
                                             p_emergency_name text, p_emergency_phone text, p_email_notifications boolean,
                                             p_mailing_address text default null, p_emergency_relationship text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  update users set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''),
                   email_notifications = coalesce(p_email_notifications, true) where id = v_uid;
  update employee_profiles set address = nullif(trim(p_address), ''),
                               mailing_address = nullif(trim(p_mailing_address), ''),
                               emergency_contact_name = nullif(trim(p_emergency_name), ''),
                               emergency_contact_phone = nullif(trim(p_emergency_phone), ''),
                               emergency_contact_relationship = nullif(trim(p_emergency_relationship), '')
   where user_id = v_uid;
end $$;
revoke execute on function update_my_profile(text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function update_my_profile(text, text, text, text, text, boolean, text, text) to authenticated;
