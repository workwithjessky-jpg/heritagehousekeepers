import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin, Navigation, Star, Users, Camera, ListChecks, TriangleAlert, Clock } from 'lucide-react';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtTime, fmtMoney, mapsUrl, utcToZonedInput, titleCase, fmtHours } from '@/lib/format';
import { attendancePoints } from '@/lib/attendance-points';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, StatusBadge, JOB_STATUS, LOC_STATUS, TS_STATUS, Flags, Field, Input, Select, Textarea,
  Empty, LinkButton, DemoTag, Checkbox,
} from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import { AttendanceMap, MapLegend } from '@/components/map';
import {
  updateJob, setJobStatus, cancelSeries, assignCleaner, unassignCleaner, replaceCleaner, qualityReview, flagChecklistItem,
  logIssue, updateIssue, reviewAttendanceException,
} from '../../_actions/jobs';

export const metadata = { title: 'Job details' };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(STAFF);
  const { id } = await params;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();

  const { data: job } = await supabase.from('cleaning_jobs')
    .select('*, property:properties(*), client:clients(id,name,phone,email), checklist:cleaning_checklists(id,name), parent:cleaning_jobs!cleaning_jobs_parent_job_id_fkey(id,title)')
    .eq('id', id).single();
  if (!job) notFound();

  const [team, recs, attendance, tasks, subs, photos, issues, timesheets, checklists, followUps] = await Promise.all([
    supabase.rpc('job_team', { p_job: id }),
    ['completed', 'cancelled'].includes(job.status) ? Promise.resolve({ data: [] }) : supabase.rpc('recommend_cleaners', { p_job: id }),
    supabase.from('attendance_records').select('*, user:users!attendance_records_employee_id_fkey(full_name)').eq('job_id', id).order('clock_in_at'),
    job.checklist_id ? supabase.from('checklist_tasks').select('*').eq('checklist_id', job.checklist_id).order('sort_order') : Promise.resolve({ data: [] }),
    supabase.from('checklist_submissions').select('*').eq('job_id', id),
    supabase.from('job_photos').select('*').eq('job_id', id).order('created_at'),
    supabase.from('job_issues').select('*, reporter:users!job_issues_reported_by_fkey(full_name)').eq('job_id', id).order('created_at', { ascending: false }),
    supabase.from('timesheets').select('id,total_hours,status,flags,user:users!timesheets_employee_id_fkey(full_name)').eq('job_id', id),
    supabase.from('cleaning_checklists').select('id,name').eq('is_active', true).order('name'),
    supabase.from('cleaning_jobs').select('id,title,scheduled_start,status').eq('parent_job_id', id),
  ]);

  const paths = [...(photos.data ?? []).map((p: any) => p.storage_path), ...(subs.data ?? []).filter((x: any) => x.photo_path).map((x: any) => x.photo_path)];
  const signed = paths.length ? (await supabase.storage.from('job-photos').createSignedUrls(paths, 3600)).data ?? [] : [];
  const url = (p: string) => signed.find((x: any) => x.path === p)?.signedUrl ?? undefined;
  const subByTask = new Map((subs.data ?? []).map((x: any) => [x.task_id, x]));
  const att = (attendance.data ?? []).map((a: any) => ({ ...a, property: job.property, job: { property: job.property } }));
  const map = attendancePoints(att.length ? att : [{ property: job.property, geofence_radius_m: job.property?.geofence_radius_m ?? s.default_geofence_m }], (iso) => fmtTime(iso, tz));
  const closed = ['completed', 'cancelled'].includes(job.status);
  const sup = isSupervisor(me.role);
  const p = job.property;
  const startLocal = utcToZonedInput(job.scheduled_start, tz);
  const endLocal = utcToZonedInput(job.scheduled_end, tz);
  const hours = (new Date(job.scheduled_end).getTime() - new Date(job.scheduled_start).getTime()) / 36e5;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{job.title} <StatusBadge map={JOB_STATUS} value={job.status} /> <DemoTag show={job.is_demo} /></span>}
        subtitle={<>{fmtDateTime(job.scheduled_start, tz)} – {fmtTime(job.scheduled_end, tz)} · {hours.toFixed(1)} h · {job.cleaning_type}{job.recurrence_rule !== 'none' && ` · repeats ${job.recurrence_rule}`}</>}
        actions={<>
          <LinkButton href={`/admin/jobs/new?parent=${job.id}`} variant="secondary">Schedule follow-up</LinkButton>
          <LinkButton href={`/admin/schedule?view=day&date=${startLocal.slice(0, 10)}`} variant="ghost">Day view</LinkButton>
        </>}
      />
      {job.completion_exception && (
        <div className="mb-4 flex gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> <span><b>Completed with exception:</b> {job.completion_exception}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* property & instructions */}
          <Card>
            <CardHeader title="Property" action={<a href={mapsUrl(p.address, p.latitude, p.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-sage-700 hover:underline"><Navigation className="size-4" />Directions</a>} />
            <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <Link href={`/admin/clients/${job.client.id}`} className="font-medium text-ink hover:text-sage-700">{job.client.name}</Link>
                <div className="text-stone-600"><Link href={`/admin/properties/${p.id}`} className="hover:underline">{p.name}</Link></div>
                <div className="mt-1 flex items-start gap-1.5 text-stone-500"><MapPin className="mt-0.5 size-4 shrink-0" />{p.address}</div>
                <div className="mt-1 text-stone-500">{[p.bedrooms && `${p.bedrooms} bd`, p.bathrooms && `${p.bathrooms} ba`, p.square_feet && `${p.square_feet} sq ft`].filter(Boolean).join(' · ')}</div>
                {job.client.phone && <div className="mt-1 text-stone-500">Client: {job.client.phone}</div>}
              </div>
              <div className="space-y-2">
                {job.instructions && <div><div className="text-xs font-semibold uppercase text-stone-400">Job instructions</div><p className="whitespace-pre-wrap text-stone-700">{job.instructions}</p></div>}
                {p.special_instructions && <div><div className="text-xs font-semibold uppercase text-stone-400">Property notes</div><p className="whitespace-pre-wrap text-stone-700">{p.special_instructions}</p></div>}
                {p.access_instructions && <div><div className="text-xs font-semibold uppercase text-stone-400">Access</div><p className="whitespace-pre-wrap text-stone-700">{p.access_instructions}</p></div>}
                {job.price != null && <div className="text-stone-600">Price: <b>{fmtMoney(job.price, s.currency)}</b></div>}
                {job.parent && <div className="text-stone-600">Follow-up of <Link className="text-sage-700 underline" href={`/admin/jobs/${job.parent.id}`}>{job.parent.title}</Link></div>}
                {(followUps.data ?? []).map((f: any) => <div key={f.id} className="text-stone-600">Follow-up: <Link className="text-sage-700 underline" href={`/admin/jobs/${f.id}`}>{f.title}</Link></div>)}
              </div>
            </CardBody>
          </Card>

          {/* attendance */}
          <Card>
            <CardHeader title="Attendance & GPS" subtitle={`Geofence radius ${p.geofence_radius_m ?? s.default_geofence_m} m${p.latitude == null ? ' · property has no coordinates — add them to verify location' : ''}`} />
            <CardBody className="space-y-4">
              {p.latitude != null && <div><AttendanceMap points={map.points} links={map.links} height={260} /><MapLegend /></div>}
              {(attendance.data ?? []).length === 0 ? <p className="text-sm text-stone-500">No one has clocked in yet.</p> : (
                <ul className="divide-y divide-stone-100 text-sm">
                  {(attendance.data as any[]).map((a) => (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div>
                        <div className="font-medium text-ink">{a.user?.full_name}</div>
                        <div className="text-stone-500">
                          In {fmtTime(a.clock_in_at, tz)}{a.clock_in_distance_m != null && ` (${Math.round(a.clock_in_distance_m)} m)`}
                          {' · '}Out {a.clock_out_at ? fmtTime(a.clock_out_at, tz) : '—'}
                          {a.total_minutes != null && ` · ${(a.total_minutes / 60).toFixed(2)} h worked, ${a.break_minutes} min break`}
                        </div>
                        {a.exception_reason && <div className="mt-1 text-amber-800">Exception: {a.exception_reason}</div>}
                        <div className="mt-1"><Flags flags={a.flags} /></div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge map={LOC_STATUS} value={a.clock_in_location} />
                        {a.status === 'exception_pending' && sup && (
                          <div className="flex gap-1">
                            <ActionButton action={reviewAttendanceException} fields={{ id: a.id, decision: 'approve' }} variant="success">Approve</ActionButton>
                            <ActionButton action={reviewAttendanceException} fields={{ id: a.id, decision: 'reject' }} variant="danger">Reject</ActionButton>
                          </div>
                        )}
                        {a.status === 'exception_pending' && !sup && <Badge tone="amber">Awaiting supervisor</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {(timesheets.data ?? []).length > 0 && (
                <div className="rounded-xl bg-stone-50 p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold uppercase text-stone-400">Timesheet entries</div>
                  {(timesheets.data as any[]).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 py-0.5">
                      <span>{t.user?.full_name} · {fmtHours(t.total_hours)}</span><StatusBadge map={TS_STATUS} value={t.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* checklist */}
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><ListChecks className="size-4" />Checklist {job.checklist ? `· ${job.checklist.name}` : ''}</span>}
              subtitle={(tasks.data ?? []).length ? `${(subs.data ?? []).filter((x: any) => x.completed).length} of ${(tasks.data ?? []).length} tasks done` : undefined} />
            {(tasks.data ?? []).length === 0 ? <Empty title="No checklist attached">Pick one under “Edit job”.</Empty> : (
              <ul className="divide-y divide-stone-100">
                {(tasks.data as any[]).map((t) => {
                  const sub: any = subByTask.get(t.id);
                  return (
                    <li key={t.id} className="flex flex-wrap items-start gap-3 px-5 py-2.5 text-sm">
                      <span className={`mt-0.5 size-4 shrink-0 rounded border ${sub?.completed ? 'border-emerald-600 bg-emerald-600' : 'border-stone-300'}`} />
                      <div className="min-w-0 flex-1">
                        <div className={sub?.completed ? 'text-stone-700' : 'text-stone-900'}>
                          <span className="text-stone-400">{t.area} · </span>{t.task}
                          {t.is_required && <span className="ml-1 text-xs text-stone-400">required</span>}
                          {t.requires_photo && <Camera className="ml-1 inline size-3.5 text-stone-400" />}
                        </div>
                        {sub?.notes && <div className="text-xs text-stone-500">“{sub.notes}”</div>}
                        {sub?.completed_at && <div className="text-xs text-stone-400">Done {fmtTime(sub.completed_at, tz)}</div>}
                        {sub?.flagged && <div className="text-xs font-medium text-red-700">Flagged: {sub.flag_note}</div>}
                      </div>
                      {sub?.photo_path && url(sub.photo_path) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={url(sub.photo_path)} target="_blank" rel="noreferrer"><img src={url(sub.photo_path)} alt="" className="size-12 rounded-lg object-cover" /></a>
                      )}
                      {sub && (
                        sub.flagged
                          ? <ActionButton action={flagChecklistItem} fields={{ id: sub.id, flagged: 'false' }} variant="ghost">Clear flag</ActionButton>
                          : <ActionForm action={flagChecklistItem} className="flex gap-1">
                              <input type="hidden" name="id" value={sub.id} />
                              <Input name="flag_note" placeholder="Flag note" className="h-8 w-32 text-xs" />
                              <SubmitButton size="sm" variant="secondary">Flag</SubmitButton>
                            </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* photos */}
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Camera className="size-4" />Photos</span>} subtitle={`${(photos.data ?? []).length} uploaded`} />
            <CardBody>
              {(photos.data ?? []).length === 0 ? <p className="text-sm text-stone-500">No photos yet.</p> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(photos.data as any[]).map((ph) => (
                    <a key={ph.id} href={url(ph.storage_path)} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-xl bg-stone-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {url(ph.storage_path) && <img src={url(ph.storage_path)} alt={ph.caption ?? ph.kind} className="aspect-square w-full object-cover" />}
                      <span className="absolute top-2 left-2"><Badge tone={ph.kind === 'issue' ? 'red' : ph.kind === 'before' ? 'gray' : 'green'}>{titleCase(ph.kind)}</Badge></span>
                      <span className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/60 px-2 py-1 text-[11px] text-white">{fmtTime(ph.created_at, tz)}{ph.caption ? ` · ${ph.caption}` : ''}</span>
                    </a>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* issues */}
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><TriangleAlert className="size-4" />Issues</span>} />
            <CardBody className="space-y-3">
              {(issues.data as any[] ?? []).map((i) => (
                <div key={i.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.status === 'resolved' ? 'green' : 'red'}>{titleCase(i.status)}</Badge>
                    <span className="font-medium">{titleCase(i.category)}</span>
                    <span className="text-stone-500">· {i.reporter?.full_name ?? titleCase(i.source)} · {fmtDateTime(i.created_at, tz)}</span>
                  </div>
                  <p className="mt-1 text-stone-700">{i.description}</p>
                  {i.photo_path && url(i.photo_path) && <a className="text-xs text-sage-700 underline" href={url(i.photo_path)} target="_blank" rel="noreferrer">View photo</a>}
                  {i.resolution && <p className="mt-1 text-stone-500">Resolution: {i.resolution}</p>}
                  {i.status !== 'resolved' && (
                    <ActionForm action={updateIssue} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={i.id} />
                      <Input name="resolution" placeholder="Resolution notes" className="h-8 max-w-xs flex-1 text-xs" />
                      <Select name="status" className="h-8 w-36 text-xs" defaultValue="resolved"><option value="in_progress">In progress</option><option value="resolved">Resolved</option></Select>
                      <SubmitButton size="sm" variant="secondary">Update</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ))}
              <details className="rounded-xl bg-stone-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-stone-700">Record an issue / quality concern</summary>
                <ActionForm action={logIssue} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                  <input type="hidden" name="job_id" value={job.id} />
                  <Select name="category" defaultValue="quality">
                    {['quality', 'damage', 'access', 'supplies', 'safety', 'client_request', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                  </Select>
                  <Input name="description" required placeholder="What happened?" />
                  <SubmitButton variant="secondary">Save</SubmitButton>
                </ActionForm>
              </details>
            </CardBody>
          </Card>
        </div>

        {/* right column */}
        <div className="space-y-6">
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Users className="size-4" />Team</span>} />
            <CardBody className="space-y-3">
              {(team.data ?? []).length === 0 && <p className="text-sm text-amber-700">No cleaners assigned.</p>}
              {(team.data as any[] ?? []).map((m) => (
                <div key={m.employee_id} className="rounded-xl border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/employees/${m.employee_id}`} className="text-sm font-medium text-ink hover:text-sage-700">{m.full_name}</Link>
                    <div className="flex gap-1">{m.is_team_lead && <Badge tone="sage">Lead</Badge>}<Badge tone={m.status === 'confirmed' ? 'indigo' : 'gray'}>{titleCase(m.status)}</Badge></div>
                  </div>
                  {!closed && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ActionForm action={replaceCleaner} className="flex flex-1 gap-1">
                        <input type="hidden" name="job_id" value={job.id} />
                        <input type="hidden" name="old_employee_id" value={m.employee_id} />
                        <Select name="employee_id" className="h-8 flex-1 text-xs" required defaultValue="">
                          <option value="" disabled>Replace with…</option>
                          {(recs.data as any[] ?? []).filter((r) => !r.blocked).map((r) => <option key={r.employee_id} value={r.employee_id}>{r.full_name}</option>)}
                        </Select>
                        <SubmitButton size="sm" variant="secondary">Swap</SubmitButton>
                      </ActionForm>
                      <ActionButton action={unassignCleaner} fields={{ job_id: job.id, employee_id: m.employee_id }} variant="ghost" confirm={`Remove ${m.full_name} from this job?`}>Remove</ActionButton>
                    </div>
                  )}
                </div>
              ))}

              {!closed && (
                <ActionForm action={assignCleaner} className="space-y-2 border-t border-stone-100 pt-3">
                  <input type="hidden" name="job_id" value={job.id} />
                  <Field label="Add cleaner (ranked by availability, distance & workload)">
                    <Select name="employee_id" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {(recs.data as any[] ?? []).map((r) => (
                        <option key={r.employee_id} value={r.employee_id}>
                          {r.blocked ? '⛔ ' : r.warnings?.length ? '⚠ ' : '✓ '}{r.full_name} · {r.week_hours} h this wk{r.distance_km != null ? ` · ${r.distance_km} km` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Checkbox name="team_lead" label="Team lead" />
                  {sup && <Checkbox name="force" label="Override blocking conflicts (logged)" />}
                  <SubmitButton className="w-full">Assign & notify</SubmitButton>
                </ActionForm>
              )}
              {(recs.data as any[] ?? []).some((r) => r.warnings?.length) && (
                <details className="text-xs text-stone-600">
                  <summary className="cursor-pointer font-medium">Why some cleaners are flagged</summary>
                  <ul className="mt-2 space-y-1">
                    {(recs.data as any[]).filter((r) => r.warnings?.length).map((r) => (
                      <li key={r.employee_id}><b>{r.full_name}:</b> {r.warnings.join(' ')}</li>
                    ))}
                  </ul>
                </details>
              )}
            </CardBody>
          </Card>

          {job.status === 'completed' || job.status === 'needs_attention' ? (
            <Card>
              <CardHeader title={<span className="inline-flex items-center gap-2"><Star className="size-4" />Quality review</span>} />
              <CardBody>
                <ActionForm action={qualityReview} className="space-y-3">
                  <input type="hidden" name="id" value={job.id} />
                  <Field label="Result">
                    <Select name="quality_status" defaultValue={job.quality_status}>
                      <option value="pending">Pending review</option><option value="passed">Passed</option><option value="flagged">Flagged — needs follow-up</option>
                    </Select>
                  </Field>
                  <Field label="Quality notes"><Textarea name="quality_notes" defaultValue={job.quality_notes ?? ''} rows={2} /></Field>
                  <Field label="Client feedback"><Textarea name="client_feedback" defaultValue={job.client_feedback ?? ''} rows={2} /></Field>
                  <Field label="Client rating">
                    <Select name="client_rating" defaultValue={job.client_rating ?? ''}>
                      <option value="">Not rated</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton className="w-full">Save review</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {!closed && (
            <Card>
              <CardHeader title="Edit / reschedule" subtitle="Assigned cleaners are notified of time changes" />
              <CardBody>
                <ActionForm action={updateJob} className="space-y-3">
                  <input type="hidden" name="id" value={job.id} />
                  <Field label="Title"><Input name="title" defaultValue={job.title} required /></Field>
                  <Field label="Cleaning type">
                    <Select name="cleaning_type" defaultValue={job.cleaning_type}>
                      {[...new Set([job.cleaning_type, ...((s.job_types as string[]) ?? [])])].map((t) => <option key={t}>{t}</option>)}
                    </Select>
                  </Field>
                  <Field label="Date"><Input type="date" name="date" defaultValue={startLocal.slice(0, 10)} required /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start"><Input type="time" name="start_time" defaultValue={startLocal.slice(11)} required /></Field>
                    <Field label="End"><Input type="time" name="end_time" defaultValue={endLocal.slice(11)} required /></Field>
                  </div>
                  <Field label="Checklist">
                    <Select name="checklist_id" defaultValue={job.checklist_id ?? ''}>
                      <option value="">None</option>{(checklists.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Price"><Input type="number" step="0.01" min="0" name="price" defaultValue={job.price ?? ''} /></Field>
                  <Field label="Instructions"><Textarea name="instructions" defaultValue={job.instructions ?? ''} rows={3} /></Field>
                  <SubmitButton className="w-full">Save changes</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Clock className="size-4" />Status</span>} />
            <CardBody className="space-y-3">
              {!closed && (
                <div className="flex flex-wrap gap-2">
                  {job.status !== 'needs_attention' && <ActionButton action={setJobStatus} fields={{ id: job.id, status: 'needs_attention' }}>Flag: needs attention</ActionButton>}
                  {job.status === 'in_progress' && sup && <ActionButton action={setJobStatus} fields={{ id: job.id, status: 'completed' }} confirm="Mark complete without the cleaner clocking out?">Mark completed</ActionButton>}
                </div>
              )}
              {job.status !== 'cancelled' && job.status !== 'completed' && (
                <ActionForm action={setJobStatus} confirm="Cancel this appointment? Assigned cleaners will be notified." className="space-y-2">
                  <input type="hidden" name="id" value={job.id} /><input type="hidden" name="status" value="cancelled" />
                  <Input name="reason" placeholder="Cancellation reason" required />
                  <SubmitButton variant="danger" className="w-full">Cancel this appointment</SubmitButton>
                </ActionForm>
              )}
              {job.recurrence_group_id && job.status !== 'cancelled' && (
                <ActionForm action={cancelSeries} confirm="Cancel ALL upcoming visits in this recurring series?" className="space-y-2">
                  <input type="hidden" name="recurrence_group_id" value={job.recurrence_group_id} />
                  <Input name="reason" placeholder="Reason for ending the series" required />
                  <SubmitButton variant="danger" className="w-full">Cancel upcoming series</SubmitButton>
                </ActionForm>
              )}
              {job.status === 'cancelled' && <p className="text-sm text-stone-600">Cancelled{job.cancelled_reason ? `: ${job.cancelled_reason}` : ''}</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
