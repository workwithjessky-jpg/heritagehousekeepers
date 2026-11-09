import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole, STAFF, getSettings, ROLE_LABEL, isSupervisor, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtPlainDate, fmtMoney, titleCase, fmtTime } from '@/lib/format';
import {
  Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Badge, Checkbox, StatusBadge, LOC_STATUS, REQ_STATUS, Flags, LinkButton, Tabs,
} from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import {
  updateEmployeeProfile, updateCompensation, updateAccess, sendPasswordReset, saveOnboarding, addRecord, addPerformanceNote,
  uploadDocument, deleteDocument, removeAvailability,
} from '../../_actions/people';
import { AvailabilityForm } from '@/components/availability-form';

export const metadata = { title: 'Employee' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requireRole(STAFF);
  const { id } = await params;
  const { tab = 'profile' } = await searchParams;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const { data: u } = await supabase.from('users').select('*, employee_profiles(*)').eq('id', id).single();
  if (!u) notFound();
  const p = u.employee_profiles ?? {};
  const owner = me.role === 'owner';
  const sup = isSupervisor(me.role);
  const base = `/admin/employees/${id}`;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{u.full_name} {!u.is_active && <Badge tone="red">Inactive</Badge>}</span>}
        subtitle={`${ROLE_LABEL[u.role_key as Role]} · ${p.job_title ?? ''} · ${u.email}${u.phone ? ' · ' + u.phone : ''}`}
        actions={<LinkButton href={`/admin/schedule?view=week&employee=${id}`} variant="secondary">View schedule</LinkButton>}
      />
      <Tabs active={tab} tabs={[
        { key: 'profile', label: 'Profile', href: base },
        { key: 'pay', label: 'Pay & access', href: `${base}?tab=pay` },
        { key: 'availability', label: 'Availability', href: `${base}?tab=availability` },
        { key: 'hr', label: 'Onboarding & training', href: `${base}?tab=hr` },
        { key: 'documents', label: 'Documents', href: `${base}?tab=documents` },
        { key: 'attendance', label: 'Attendance', href: `${base}?tab=attendance` },
        ...(sup ? [{ key: 'performance', label: 'Performance', href: `${base}?tab=performance` }] : []),
      ]} />

      {tab === 'profile' && (
        <Card className="max-w-3xl">
          <CardHeader title="Personal & employment details" />
          <CardBody>
            <ActionForm action={updateEmployeeProfile} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="user_id" value={id} />
              <Field label="Full name"><Input name="full_name" defaultValue={u.full_name} required /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={u.phone ?? ''} /></Field>
              <Field label="Job title"><Input name="job_title" defaultValue={p.job_title ?? ''} /></Field>
              <Field label="Employee #"><Input name="employee_number" defaultValue={p.employee_number ?? ''} /></Field>
              <Field label="Employment status">
                <Select name="employment_status" defaultValue={p.employment_status}>
                  {['onboarding', 'active', 'on_leave', 'inactive', 'terminated'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                </Select>
              </Field>
              <Field label="Hire date"><Input type="date" name="hire_date" defaultValue={p.hire_date ?? ''} /></Field>
              <Field label="Team"><Input name="team" defaultValue={p.team ?? ''} /></Field>
              <Field label="Home address" className="sm:col-span-2"><Input name="address" defaultValue={p.address ?? ''} /></Field>
              <Field label="Home latitude" hint="Optional — improves cleaner recommendations by distance"><Input name="home_latitude" type="number" step="any" defaultValue={p.home_latitude ?? ''} /></Field>
              <Field label="Home longitude"><Input name="home_longitude" type="number" step="any" defaultValue={p.home_longitude ?? ''} /></Field>
              <Field label="Emergency contact"><Input name="emergency_contact_name" defaultValue={p.emergency_contact_name ?? ''} /></Field>
              <Field label="Emergency phone"><Input name="emergency_contact_phone" defaultValue={p.emergency_contact_phone ?? ''} /></Field>
              <div className="text-sm text-stone-600 sm:col-span-2">Location policy: {p.location_consent_at ? <Badge tone="green">Accepted {fmtDateTime(p.location_consent_at, tz)}</Badge> : <Badge tone="amber">Not yet accepted (asked at first clock-in)</Badge>}</div>
              <div className="sm:col-span-2"><SubmitButton>Save profile</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {tab === 'pay' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Compensation profile" subtitle={owner ? 'Owner only' : 'View only — owner can edit'} />
            <CardBody>
              {me.role === 'office_admin' ? <p className="text-sm text-stone-500">Compensation is visible to the owner and operations managers.</p> : (
                <ActionForm action={updateCompensation} className="space-y-3">
                  <fieldset disabled={!owner} className="space-y-3">
                    <input type="hidden" name="user_id" value={id} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={`Hourly rate (${s.currency})`}><Input name="pay_rate" type="number" step="0.01" min="0" defaultValue={p.pay_rate} required /></Field>
                      <Field label="Employment type">
                        <Select name="employment_type" defaultValue={p.employment_type}>
                          {['hourly_employee', 'part_time', 'seasonal', 'contractor', 'salaried'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <Field label="Pay frequency override">
                      <Select name="pay_frequency" defaultValue={p.pay_frequency ?? ''}>
                        <option value="">Company default ({titleCase(s.pay_frequency)})</option>
                        {['weekly', 'biweekly', 'semimonthly', 'monthly'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                      </Select>
                    </Field>
                    <Checkbox name="overtime_eligible" defaultChecked={p.overtime_eligible} label="Eligible for overtime (when overtime is enabled in Settings)" />
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Weekly OT after (h)"><Input name="overtime_weekly_threshold" type="number" step="0.25" defaultValue={p.overtime_weekly_threshold ?? ''} placeholder={String(s.overtime_weekly_threshold ?? '—')} /></Field>
                      <Field label="Daily OT after (h)"><Input name="overtime_daily_threshold" type="number" step="0.25" defaultValue={p.overtime_daily_threshold ?? ''} placeholder={String(s.overtime_daily_threshold ?? '—')} /></Field>
                      <Field label="OT multiplier"><Input name="overtime_multiplier" type="number" step="0.05" defaultValue={p.overtime_multiplier ?? ''} placeholder={String(s.overtime_multiplier)} /></Field>
                    </div>
                    <Field label="Deductions (one per line)" hint="Format: Name | fixed | 10   or   Name | percent | 3. Only what you list here is deducted — taxes are not calculated.">
                      <Textarea name="deductions" rows={3} defaultValue={(p.deductions ?? []).map((d: any) => `${d.name} | ${d.type} | ${d.amount}`).join('\n')} />
                    </Field>
                  </fieldset>
                  {owner && <SubmitButton>Save compensation</SubmitButton>}
                </ActionForm>
              )}
            </CardBody>
          </Card>
          <Card className="h-fit">
            <CardHeader title="Login & access" />
            <CardBody className="space-y-4">
              {owner ? (
                <ActionForm action={updateAccess} className="space-y-3">
                  <input type="hidden" name="user_id" value={id} />
                  <Field label="Role">
                    <Select name="role" defaultValue={u.role_key}>{(['cleaner', 'office_admin', 'ops_manager', 'owner'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
                  </Field>
                  <Field label="Account">
                    <Select name="is_active" defaultValue={String(u.is_active)}><option value="true">Active — can sign in</option><option value="false">Deactivated — cannot sign in</option></Select>
                  </Field>
                  <SubmitButton>Update access</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-stone-600">Role: {ROLE_LABEL[u.role_key as Role]}. Only the owner can change roles.</p>}
              <ActionButton action={sendPasswordReset} fields={{ email: u.email }}>Send password reset email</ActionButton>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'availability' && <Availability id={id} />}
      {tab === 'hr' && <Hr id={id} p={p} />}
      {tab === 'documents' && <Documents id={id} tz={tz} />}
      {tab === 'attendance' && <AttendanceHistory id={id} tz={tz} currency={s.currency} showPay={me.role !== 'office_admin'} />}
      {tab === 'performance' && sup && <Performance id={id} tz={tz} />}
    </>
  );
}

async function Availability({ id }: { id: string }) {
  const supabase = await createClient();
  const [{ data: av }, { data: tor }] = await Promise.all([
    supabase.from('employee_availability').select('*').eq('employee_id', id).order('weekday').order('start_time'),
    supabase.from('time_off_requests').select('*').eq('employee_id', id).order('start_date', { ascending: false }).limit(20),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Weekly availability" subtitle="Used to warn dispatchers about out-of-hours assignments. Empty = no restriction." />
        <CardBody className="space-y-4">
          <ul className="space-y-1 text-sm">
            {(av ?? []).map((a: any) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                <span><b>{DAYS[a.weekday]}</b> {a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)} {a.notes && <span className="text-stone-500">· {a.notes}</span>}</span>
                <ActionButton action={removeAvailability} fields={{ id: a.id }} variant="ghost">Remove</ActionButton>
              </li>
            ))}
            {!(av ?? []).length && <li className="text-stone-500">No availability submitted.</li>}
          </ul>
          <AvailabilityForm userId={id} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Time off" action={<Link className="text-sm text-sage-700 hover:underline" href="/admin/time-off">Manage requests</Link>} />
        <ul className="divide-y divide-stone-100 text-sm">
          {(tor ?? []).map((t: any) => (
            <li key={t.id} className="flex items-center justify-between px-5 py-2.5">
              <span>{fmtPlainDate(t.start_date)} → {fmtPlainDate(t.end_date)} · {titleCase(t.kind)}</span><StatusBadge map={REQ_STATUS} value={t.status} />
            </li>
          ))}
          {!(tor ?? []).length && <li className="px-5 py-4 text-stone-500">No requests.</li>}
        </ul>
      </Card>
    </div>
  );
}

function Hr({ id, p }: { id: string; p: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader title="Onboarding checklist" subtitle={`${(p.onboarding_checklist ?? []).filter((x: any) => x.done).length} of ${(p.onboarding_checklist ?? []).length} done`} />
        <CardBody>
          <ActionForm action={saveOnboarding} className="space-y-2">
            <input type="hidden" name="user_id" value={id} />
            {(p.onboarding_checklist ?? []).map((x: any) => (
              <div key={x.item}>
                <input type="hidden" name="item" value={x.item} />
                <Checkbox name="done" value={x.item} defaultChecked={x.done} label={x.item} />
              </div>
            ))}
            <Input name="new_item" placeholder="Add an item…" className="mt-2" />
            <SubmitButton variant="secondary">Save checklist</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      {(['training_records', 'certifications'] as const).map((field) => (
        <Card key={field}>
          <CardHeader title={field === 'training_records' ? 'Training records' : 'Certifications'} />
          <CardBody className="space-y-3">
            <ul className="space-y-2 text-sm">
              {(p[field] ?? []).map((r: any, i: number) => (
                <li key={i} className="rounded-lg bg-stone-50 px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-stone-500">{r.date && `Completed ${fmtPlainDate(r.date)}`}{r.expires && ` · expires ${fmtPlainDate(r.expires)}`}{r.notes && ` · ${r.notes}`}</div>
                </li>
              ))}
              {!(p[field] ?? []).length && <li className="text-stone-500">None recorded.</li>}
            </ul>
            <ActionForm action={addRecord} resetOnSuccess className="space-y-2">
              <input type="hidden" name="user_id" value={id} /><input type="hidden" name="field" value={field} />
              <Input name="name" placeholder={field === 'training_records' ? 'e.g. Chemical safety' : 'e.g. First Aid'} required />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-stone-500">Date<Input type="date" name="date" /></label>
                <label className="text-xs text-stone-500">Expires<Input type="date" name="expires" /></label>
              </div>
              <Input name="notes" placeholder="Notes" />
              <SubmitButton variant="secondary" size="sm">Add</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

async function Documents({ id, tz }: { id: string; tz: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false });
  const signed = (docs ?? []).length ? (await supabase.storage.from('employee-documents').createSignedUrls((docs ?? []).map((d: any) => d.storage_path), 600)).data ?? [] : [];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Documents" subtitle="Private storage — visible to management and to this employee" />
        <ul className="divide-y divide-stone-100 text-sm">
          {(docs ?? []).map((d: any) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div>
                <a className="font-medium text-ink hover:text-sage-700" href={signed.find((x: any) => x.path === d.storage_path)?.signedUrl ?? '#'} target="_blank" rel="noreferrer">{d.name}</a>
                <div className="text-xs text-stone-500">{titleCase(d.category)} · uploaded {fmtDateTime(d.created_at, tz)}{d.expires_on && ` · expires ${fmtPlainDate(d.expires_on)}`}</div>
              </div>
              <ActionButton action={deleteDocument} fields={{ id: d.id }} variant="ghost" confirm="Delete this document permanently?">Delete</ActionButton>
            </li>
          ))}
          {!(docs ?? []).length && <li className="px-5 py-6 text-stone-500">No documents uploaded.</li>}
        </ul>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Upload" />
        <CardBody>
          <ActionForm action={uploadDocument} resetOnSuccess className="space-y-3">
            <input type="hidden" name="user_id" value={id} />
            <Input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" className="h-auto py-2" />
            <Input name="name" placeholder="Document name (optional)" />
            <Select name="category" defaultValue="other">
              {['contract', 'identification', 'tax', 'certification', 'training', 'policy', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
            <label className="block text-xs text-stone-500">Expires on<Input type="date" name="expires_on" /></label>
            <SubmitButton className="w-full" pendingText="Uploading…">Upload</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function AttendanceHistory({ id, tz, currency, showPay }: { id: string; tz: string; currency: string; showPay: boolean }) {
  const supabase = await createClient();
  const [{ data: att }, { data: ts }] = await Promise.all([
    supabase.from('attendance_records').select('*, job:cleaning_jobs(id,title)').eq('employee_id', id).order('clock_in_at', { ascending: false }).limit(50),
    supabase.from('timesheets').select('work_date,total_hours,estimated_earnings,status').eq('employee_id', id).order('work_date', { ascending: false }).limit(200),
  ]);
  const totalH = (ts ?? []).reduce((a: number, t: any) => a + Number(t.total_hours), 0);
  const flagged = (att ?? []).filter((a: any) => a.flags?.length).length;
  return (
    <Card>
      <CardHeader title="Attendance history" subtitle={`${(att ?? []).length} recent shifts · ${flagged} with flags · ${totalH.toFixed(1)} h on recent timesheets${showPay ? ` · ${fmtMoney((ts ?? []).reduce((a: number, t: any) => a + Number(t.estimated_earnings), 0), currency)} est.` : ''}`} />
      <ul className="divide-y divide-stone-100 text-sm">
        {(att ?? []).map((a: any) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="w-44 text-stone-500">{fmtDateTime(a.clock_in_at, tz)}</span>
            <Link href={`/admin/jobs/${a.job?.id}`} className="min-w-40 flex-1 hover:text-sage-700">{a.job?.title}</Link>
            <span className="tabular-nums">{a.clock_out_at ? `${fmtTime(a.clock_out_at, tz)} · ${((a.total_minutes ?? 0) / 60).toFixed(2)} h` : 'on the clock'}</span>
            <StatusBadge map={LOC_STATUS} value={a.clock_in_location} />
            <Flags flags={a.flags} />
          </li>
        ))}
        {!(att ?? []).length && <li className="px-5 py-6 text-stone-500">No attendance yet.</li>}
      </ul>
    </Card>
  );
}

async function Performance({ id, tz }: { id: string; tz: string }) {
  const supabase = await createClient();
  const [{ data: notes }, { data: jobs }] = await Promise.all([
    supabase.from('employee_performance_notes').select('*, author:users!employee_performance_notes_author_id_fkey(full_name)').eq('employee_id', id).order('created_at', { ascending: false }),
    supabase.from('job_assignments').select('job:cleaning_jobs!inner(status,quality_status,client_rating,scheduled_start)').eq('employee_id', id).eq('job.status', 'completed'),
  ]);
  const done = (jobs ?? []).map((j: any) => j.job);
  const rated = done.filter((j: any) => j.client_rating);
  const avg = rated.length ? rated.reduce((a: number, j: any) => a + j.client_rating, 0) / rated.length : null;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5">
        <div className="text-sm text-stone-500">Completed jobs</div><div className="text-3xl font-semibold">{done.length}</div>
        <div className="mt-3 text-sm text-stone-500">Average client rating</div><div className="text-2xl font-semibold">{avg ? `${avg.toFixed(1)} ★` : '—'}</div>
        <div className="mt-3 text-sm text-stone-500">QC flagged</div><div className="text-2xl font-semibold">{done.filter((j: any) => j.quality_status === 'flagged').length}</div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Performance notes" subtitle="Private to owner and operations managers" />
        <CardBody className="space-y-3">
          <ActionForm action={addPerformanceNote} resetOnSuccess className="space-y-2">
            <input type="hidden" name="user_id" value={id} />
            <Textarea name="note" required rows={2} placeholder="Recognition, coaching, follow-ups…" />
            <div className="flex gap-2">
              <Select name="rating" className="w-40" defaultValue=""><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select>
              <SubmitButton variant="secondary">Add note</SubmitButton>
            </div>
          </ActionForm>
          {(notes ?? []).map((n: any) => (
            <div key={n.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <div className="text-xs text-stone-500">{n.author?.full_name} · {fmtDateTime(n.created_at, tz)}{n.rating && ` · ${n.rating}/5`}</div>
              <p className="mt-1 whitespace-pre-wrap">{n.note}</p>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
