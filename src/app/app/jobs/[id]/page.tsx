import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Navigation, Clock, MapPin, Users, KeyRound, Phone, TriangleAlert, Info } from 'lucide-react';
import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtTime, fmtDateTime, mapsUrl, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, StatusBadge, JOB_STATUS, Badge, Select, Textarea, DemoTag } from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import { ClockPanel } from './clock-panel';
import { Checklist, PhotoButton } from './job-work';
import { confirmJob, reportIssue } from '../../actions';

export const metadata = { title: 'Job' };

export default async function CleanerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(['cleaner']);
  const { id } = await params;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();

  // RLS returns nothing unless this cleaner is assigned to the job
  const { data: job } = await supabase.from('cleaning_jobs').select('*, property:properties(*), client:clients(name)').eq('id', id).maybeSingle();
  if (!job) notFound();

  const [team, myAssign, myAttendance, openAny, codes, tasks, subs, photos, profile, completion, myIssues] = await Promise.all([
    supabase.rpc('job_team', { p_job: id }),
    supabase.from('job_assignments').select('status,is_team_lead').eq('job_id', id).eq('employee_id', me.id).maybeSingle(),
    supabase.from('attendance_records').select('id,clock_in_at,clock_out_at,clock_in_location').eq('job_id', id).order('clock_in_at'),
    supabase.from('attendance_records').select('id,job_id').is('clock_out_at', null).maybeSingle(),
    supabase.from('property_access_codes').select('*').eq('property_id', job.property_id).maybeSingle(),
    job.checklist_id ? supabase.from('checklist_tasks').select('*').eq('checklist_id', job.checklist_id).order('sort_order') : Promise.resolve({ data: [] }),
    supabase.from('checklist_submissions').select('task_id,completed,notes,photo_path').eq('job_id', id),
    supabase.from('job_photos').select('id,kind,storage_path,created_at').eq('job_id', id).order('created_at'),
    supabase.from('employee_profiles').select('location_consent_at').eq('user_id', me.id).single(),
    supabase.rpc('job_completion_status', { p_job: id }),
    supabase.from('job_issues').select('id,category,description,status,created_at').eq('job_id', id).order('created_at', { ascending: false }),
  ]);

  const open = (myAttendance.data ?? []).find((a: any) => !a.clock_out_at) ?? null;
  const worked = (myAttendance.data ?? []).some((a: any) => a.clock_out_at);
  const p = job.property;
  const closed = ['completed', 'cancelled'].includes(job.status);
  const subMap = Object.fromEntries((subs.data ?? []).map((x: any) => [x.task_id, x]));
  const photoList = (photos.data ?? []) as any[];
  const signed = photoList.length ? (await supabase.storage.from('job-photos').createSignedUrls(photoList.map((x) => x.storage_path), 3600)).data ?? [] : [];
  const comp = (completion.data ?? { required_open: [], photos_missing: [] }) as any;
  const hours = (new Date(job.scheduled_end).getTime() - new Date(job.scheduled_start).getTime()) / 36e5;

  return (
    <div className="space-y-4">
      <Link href="/app/schedule" className="inline-flex items-center gap-1 text-sm text-stone-600"><ChevronLeft className="size-4" />Schedule</Link>

      <div>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge map={JOB_STATUS} value={job.status} /><DemoTag show={job.is_demo} />{myAssign.data?.is_team_lead && <Badge tone="sage">You&apos;re team lead</Badge>}</div>
        <h1 className="mt-1 text-xl font-semibold text-ink">{job.title}</h1>
        <p className="text-sm text-stone-600">{job.client?.name} · {job.cleaning_type}</p>
      </div>

      <Card>
        <CardBody className="space-y-3 text-[15px]">
          <div className="flex items-start gap-3"><Clock className="mt-0.5 size-5 text-sage-700" /><div>{fmtDateTime(job.scheduled_start, tz)} – {fmtTime(job.scheduled_end, tz)}<div className="text-sm text-stone-500">About {hours.toFixed(1)} hours</div></div></div>
          <div className="flex items-start gap-3"><MapPin className="mt-0.5 size-5 text-sage-700" /><div>{p.name}<div className="text-sm text-stone-500">{p.address}</div>
            <div className="text-sm text-stone-500">{[p.bedrooms && `${p.bedrooms} bed`, p.bathrooms && `${p.bathrooms} bath`, p.square_feet && `${p.square_feet} sq ft`].filter(Boolean).join(' · ')}</div></div></div>
          <a href={mapsUrl(p.address, p.latitude, p.longitude)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-sage-300 bg-sage-50 font-semibold text-sage-800">
            <Navigation className="size-5" />Navigate with Google Maps
          </a>
          <div className="flex items-start gap-3"><Users className="mt-0.5 size-5 text-sage-700" /><div>{(team.data as any[] ?? []).map((m) => <span key={m.employee_id} className="mr-2 inline-flex items-center gap-1">{m.full_name}{m.is_team_lead && <Badge tone="sage">Lead</Badge>}</span>)}</div></div>
        </CardBody>
      </Card>

      {myAssign.data?.status === 'assigned' && !closed && (
        <ActionButton action={confirmJob} fields={{ job_id: id }} variant="secondary" size="lg" className="w-full [&>button]:w-full">Confirm I&apos;ll be there</ActionButton>
      )}

      {(job.instructions || p.special_instructions || p.access_instructions) && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Info className="size-4" />Instructions</span>} />
          <CardBody className="space-y-3 text-[15px]">
            {job.instructions && <p className="whitespace-pre-wrap">{job.instructions}</p>}
            {p.special_instructions && <p className="whitespace-pre-wrap text-stone-700">{p.special_instructions}</p>}
            {p.access_instructions && <div><div className="text-xs font-semibold uppercase text-stone-400">Getting in</div><p className="whitespace-pre-wrap">{p.access_instructions}</p></div>}
          </CardBody>
        </Card>
      )}

      {codes.data && (codes.data.entry_code || codes.data.lockbox_code || codes.data.alarm_code) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardBody className="space-y-1 text-[15px]">
            <div className="mb-1 flex items-center gap-2 font-semibold"><KeyRound className="size-4" />Entry codes <span className="text-xs font-normal text-stone-500">(confidential)</span></div>
            {codes.data.entry_code && <div>Door: <b className="font-mono">{codes.data.entry_code}</b></div>}
            {codes.data.lockbox_code && <div>Lockbox: <b className="font-mono">{codes.data.lockbox_code}</b></div>}
            {codes.data.alarm_code && <div>Alarm: <b className="font-mono">{codes.data.alarm_code}</b></div>}
            {codes.data.notes && <div className="text-sm text-stone-600">{codes.data.notes}</div>}
          </CardBody>
        </Card>
      )}

      {job.status !== 'cancelled' && (
        <ClockPanel
          jobId={id}
          openAttendanceId={open?.id ?? null}
          openSince={open ? fmtTime(open.clock_in_at, tz) : null}
          clockedInElsewhere={!!openAny.data && openAny.data.job_id !== id}
          alreadyWorked={worked}
          jobClosed={closed}
          consentAccepted={!!profile.data?.location_consent_at}
          policyText={s.location_policy_text}
          completion={comp}
        />
      )}

      {job.status !== 'cancelled' && (
        <Card>
          <CardHeader title="Photos" subtitle={s.require_before_after_photos ? 'Before and after photos are required' : undefined} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <PhotoButton jobId={id} kind="before" label="Before photos" done={photoList.filter((x) => x.kind === 'before').length} disabled={closed && !open} />
              <PhotoButton jobId={id} kind="after" label="After photos" done={photoList.filter((x) => x.kind === 'after').length} disabled={closed && !open} />
            </div>
            {photoList.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {photoList.map((ph) => {
                  const u = signed.find((x: any) => x.path === ph.storage_path)?.signedUrl;
                  // eslint-disable-next-line @next/next/no-img-element
                  return u ? <a key={ph.id} href={u} target="_blank" rel="noreferrer" className="relative"><img src={u} alt={ph.kind} className="aspect-square w-full rounded-lg object-cover" /><span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{ph.kind}</span></a> : null;
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {(tasks.data ?? []).length > 0 && (
        <Card>
          <CardHeader title="Checklist" />
          <CardBody><Checklist jobId={id} tasks={tasks.data as any[]} subs={subMap} editable={!!open} /></CardBody>
        </Card>
      )}

      {job.status !== 'cancelled' && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><TriangleAlert className="size-4" />Report an issue</span>} subtitle="Damage, access problems, missing supplies, safety…" />
          <CardBody className="space-y-3">
            {(myIssues.data ?? []).map((i: any) => (
              <div key={i.id} className="rounded-xl bg-stone-50 px-3 py-2 text-sm"><Badge tone={i.status === 'resolved' ? 'green' : 'red'}>{titleCase(i.status)}</Badge> <b>{titleCase(i.category)}</b> — {i.description}</div>
            ))}
            <ActionForm action={reportIssue} resetOnSuccess className="space-y-2">
              <input type="hidden" name="job_id" value={id} />
              <Select name="category" defaultValue="other" className="h-12 text-base">
                {['damage', 'access', 'supplies', 'safety', 'client_request', 'quality', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
              </Select>
              <Textarea name="description" required rows={3} placeholder="What happened?" className="text-base" />
              <SubmitButton variant="secondary" size="lg" className="w-full">Send to office</SubmitButton>
            </ActionForm>
            <PhotoButton jobId={id} kind="issue" label="Add a photo of the issue" done={photoList.filter((x) => x.kind === 'issue').length} />
          </CardBody>
        </Card>
      )}

      {s.company_phone && (
        <a href={`tel:${s.company_phone}`} className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-sage-700"><Phone className="size-4" />Call the office</a>
      )}
    </div>
  );
}
