import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Navigation, Lock } from 'lucide-react';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, mapsUrl, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Textarea, Table, Th, Td, StatusBadge, JOB_STATUS, Empty, LinkButton, Badge, DemoTag } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PropertyFields } from '@/components/property-fields';
import { AttendanceMap, MapLegend } from '@/components/map';
import { updateProperty, saveAccessCodes } from '../../_actions/clients';

export const metadata = { title: 'Property' };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(STAFF);
  const { id } = await params;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const { data: p } = await supabase.from('properties').select('*, client:clients(id,name)').eq('id', id).single();
  if (!p) notFound();
  const [{ data: codes }, { data: jobs }, { data: issues }, { data: photos }] = await Promise.all([
    supabase.from('property_access_codes').select('*').eq('property_id', id).maybeSingle(),
    supabase.from('cleaning_jobs').select('id,title,scheduled_start,scheduled_end,status,completed_at,quality_status,client_rating,client_feedback,quality_notes,job_assignments(user:users!job_assignments_employee_id_fkey(full_name)),attendance_records(total_minutes)')
      .eq('property_id', id).order('scheduled_start', { ascending: false }).limit(60),
    supabase.from('job_issues').select('*').eq('property_id', id).order('created_at', { ascending: false }).limit(30),
    supabase.from('job_photos').select('storage_path,kind,created_at,job:cleaning_jobs!inner(property_id)').eq('job.property_id', id).order('created_at', { ascending: false }).limit(12),
  ]);
  const signed = (photos ?? []).length ? (await supabase.storage.from('job-photos').createSignedUrls((photos ?? []).map((x: any) => x.storage_path), 3600)).data ?? [] : [];
  const sup = isSupervisor(me.role);
  const recurring = new Map<string, number>();
  (issues ?? []).forEach((i: any) => recurring.set(i.category, (recurring.get(i.category) ?? 0) + 1));

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{p.name} <DemoTag show={p.is_demo} /></span>}
        subtitle={<><Link className="text-sage-700 hover:underline" href={`/admin/clients/${p.client.id}`}>{p.client.name}</Link> · {p.address}</>}
        actions={<>
          <a className="inline-flex items-center gap-1 text-sm font-medium text-sage-700 hover:underline" href={mapsUrl(p.address, p.latitude, p.longitude)} target="_blank" rel="noreferrer"><Navigation className="size-4" />Google Maps</a>
          <LinkButton href={`/admin/jobs/new?property=${p.id}`}>Book a clean</LinkButton>
        </>} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Location & geofence" subtitle={p.latitude != null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)} · radius ${p.geofence_radius_m ?? s.default_geofence_m} m` : 'No coordinates — GPS verification is disabled for this property'} />
            <CardBody>
              {p.latitude != null ? <><AttendanceMap points={[{ lat: p.latitude, lng: p.longitude, label: p.name, kind: 'property', radius: p.geofence_radius_m ?? s.default_geofence_m }]} height={240} /><MapLegend /></>
                : <p className="text-sm text-amber-800">Add latitude/longitude in the form below (or clear them and save to auto-lookup from the address).</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cleaning history" subtitle="Assigned cleaners, duration, quality and feedback" />
            {(jobs ?? []).length === 0 ? <Empty title="No visits yet" /> : (
              <Table>
                <thead><tr><Th>Date</Th><Th>Job</Th><Th>Cleaners</Th><Th>Worked</Th><Th>Quality</Th><Th>Feedback</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {(jobs as any[]).map((j) => {
                    const mins = (j.attendance_records ?? []).reduce((a: number, r: any) => a + (r.total_minutes ?? 0), 0);
                    return (
                      <tr key={j.id} className="hover:bg-stone-50">
                        <Td className="whitespace-nowrap">{fmtDateTime(j.scheduled_start, tz)}</Td>
                        <Td><Link href={`/admin/jobs/${j.id}`} className="hover:text-sage-700">{j.title}</Link></Td>
                        <Td>{j.job_assignments?.map((a: any) => a.user?.full_name).join(', ') || '—'}</Td>
                        <Td className="tabular-nums">{mins ? `${(mins / 60).toFixed(1)} h` : '—'}</Td>
                        <Td>{j.status === 'completed' ? <Badge tone={j.quality_status === 'passed' ? 'green' : j.quality_status === 'flagged' ? 'red' : 'gray'}>{titleCase(j.quality_status)}</Badge> : '—'}</Td>
                        <Td className="max-w-56 text-xs">{j.client_rating ? '★'.repeat(j.client_rating) + ' ' : ''}{j.client_feedback ?? j.quality_notes ?? ''}</Td>
                        <Td><StatusBadge map={JOB_STATUS} value={j.status} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Reported issues" subtitle={recurring.size ? `Recurring: ${[...recurring.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${titleCase(k)} ×${n}`).join(', ') || 'none'}` : undefined} />
            <ul className="divide-y divide-stone-100 text-sm">
              {(issues ?? []).map((i: any) => (
                <li key={i.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={i.status === 'resolved' ? 'green' : 'red'}>{titleCase(i.status)}</Badge><b>{titleCase(i.category)}</b><span className="text-stone-500">{fmtDateTime(i.created_at, tz)}</span>
                    {i.job_id && <Link className="text-xs text-sage-700 underline" href={`/admin/jobs/${i.job_id}`}>job</Link>}</div>
                  <p className="mt-1 text-stone-700">{i.description}</p>
                </li>
              ))}
              {!(issues ?? []).length && <li className="px-5 py-6 text-stone-500">No issues reported.</li>}
            </ul>
          </Card>

          {(photos ?? []).length > 0 && (
            <Card>
              <CardHeader title="Recent photos" />
              <CardBody className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {(photos as any[]).map((ph) => {
                  const u = signed.find((x: any) => x.path === ph.storage_path)?.signedUrl;
                  // eslint-disable-next-line @next/next/no-img-element
                  return u ? <a key={ph.storage_path} href={u} target="_blank" rel="noreferrer" className="relative"><img src={u} alt={ph.kind} className="aspect-square w-full rounded-lg object-cover" /><span className="absolute bottom-1 left-1"><Badge>{ph.kind}</Badge></span></a> : null;
                })}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Edit property" />
            <CardBody>
              <ActionForm action={updateProperty} className="space-y-3">
                <input type="hidden" name="id" value={p.id} />
                <PropertyFields p={p} jobTypes={s.job_types ?? []} defaultRadius={s.default_geofence_m} />
                <SubmitButton>Save property</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title={<span className="inline-flex items-center gap-2"><Lock className="size-4" />Entry & lockbox codes</span>} subtitle="Restricted: shown to assigned cleaners only from 24 h before to 12 h after their job" />
          <CardBody>
            <ActionForm action={saveAccessCodes} className="space-y-3">
              <fieldset disabled={!sup} className="space-y-3">
                <input type="hidden" name="property_id" value={p.id} />
                <Field label="Door / gate code"><Input name="entry_code" defaultValue={codes?.entry_code ?? ''} autoComplete="off" /></Field>
                <Field label="Lockbox code"><Input name="lockbox_code" defaultValue={codes?.lockbox_code ?? ''} autoComplete="off" /></Field>
                <Field label="Alarm code"><Input name="alarm_code" defaultValue={codes?.alarm_code ?? ''} autoComplete="off" /></Field>
                <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={codes?.notes ?? ''} /></Field>
              </fieldset>
              {sup ? <SubmitButton className="w-full">Save codes</SubmitButton> : <p className="text-xs text-stone-500">Only the owner or operations managers can change codes.</p>}
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
