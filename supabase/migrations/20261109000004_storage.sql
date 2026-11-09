-- =====================================================================
-- Migration 4: private storage buckets + access policies
--   job-photos/{job_id}/{file}          — assigned cleaners + staff
--   employee-documents/{employee_id}/…  — the employee (read) + staff
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
       ('employee-documents', 'employee-documents', false, 15728640,
        array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create or replace function storage_job_id(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy "job photos read" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (public.is_staff() or public.is_assigned(public.storage_job_id(name))));
create policy "job photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and (public.is_staff() or public.is_assigned(public.storage_job_id(name))));
create policy "job photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.is_staff());

create policy "employee docs read" on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and (public.is_staff() or split_part(name, '/', 1) = auth.uid()::text));
create policy "employee docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.is_staff());
create policy "employee docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.is_staff());
