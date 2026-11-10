import Link from 'next/link';
import { requireRole, getSettings, ROLE_LABEL, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Checkbox, Tabs, Table, Th, Td, Badge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { saveSettings } from '../_actions/settings';
import { IntegrationsTab } from './integrations';

export const metadata = { title: 'Settings' };

const EVENTS: [string, string][] = [
  ['clock_in', 'Cleaner clocks in'], ['clock_out', 'Cleaner clocks out'], ['geofence', 'Clock-in outside geofence / without GPS'],
  ['missed_clock_in', 'Missed clock-in'], ['forgot_clock_out', 'Forgot to clock out'], ['timesheet_submitted', 'Timesheet submitted / correction requested'],
  ['time_off', 'Time-off request'], ['issue', 'Issue reported'], ['job_completed', 'Job completed'], ['photos', 'Photos uploaded'], ['schedule_change', 'Schedule changes & cancellations'],
];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRole(['owner']);
  const { tab = 'company' } = await searchParams;
  const s = await getSettings();
  const supabase = await createClient();
  const { data: roles } = tab === 'roles' ? await supabase.from('employee_roles').select('*') : { data: [] };
  const { data: staff } = tab === 'roles' ? await supabase.from('users').select('id,full_name,role_key,is_active').order('role_key') : { data: [] };
  const Section = ({ name, children }: { name: string; children: React.ReactNode }) => (
    <ActionForm action={saveSettings} className="space-y-4"><input type="hidden" name="section" value={name} />{children}<SubmitButton>Save</SubmitButton></ActionForm>
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Every business rule is configurable here — nothing about pay, overtime or attendance is hard-coded." />
      <Tabs active={tab} tabs={[
        { key: 'company', label: 'Company', href: '/admin/settings' },
        { key: 'payroll', label: 'Payroll & overtime', href: '/admin/settings?tab=payroll' },
        { key: 'attendance', label: 'Attendance & GPS', href: '/admin/settings?tab=attendance' },
        { key: 'notifications', label: 'Notifications', href: '/admin/settings?tab=notifications' },
        { key: 'catalog', label: 'Services & hours', href: '/admin/settings?tab=catalog' },
        { key: 'roles', label: 'Roles & permissions', href: '/admin/settings?tab=roles' },
        { key: 'integrations', label: 'Integrations', href: '/admin/settings?tab=integrations' },
      ]} />

      <Card className={tab === 'integrations' ? 'max-w-5xl' : 'max-w-3xl'}>
        <CardBody>
          {tab === 'company' && (
            <Section name="company">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name"><Input name="company_name" defaultValue={s.company_name} required /></Field>
                <Field label="Email"><Input name="company_email" type="email" defaultValue={s.company_email ?? ''} /></Field>
                <Field label="Phone"><Input name="company_phone" defaultValue={s.company_phone ?? ''} /></Field>
                <Field label="Currency (ISO code)"><Input name="currency" defaultValue={s.currency} maxLength={3} required /></Field>
                <Field label="Address" className="sm:col-span-2"><Input name="company_address" defaultValue={s.company_address ?? ''} /></Field>
                <Field label="Time zone (IANA)" hint="All schedules, timesheets and pay periods use this zone, e.g. America/New_York, America/Chicago" className="sm:col-span-2">
                  <Input name="timezone" defaultValue={s.timezone} required />
                </Field>
              </div>
            </Section>
          )}

          {tab === 'payroll' && (
            <Section name="payroll">
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Overtime, breaks and pay periods follow the rules you set here. Confirm them against the labor laws for your jurisdiction and each employment arrangement. No taxes are calculated.</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Jurisdiction (for your records)"><Input name="jurisdiction" defaultValue={s.jurisdiction} required placeholder="e.g. Texas, USA" /></Field>
                <Field label="Pay frequency">
                  <Select name="pay_frequency" defaultValue={s.pay_frequency}>{['weekly', 'biweekly', 'semimonthly', 'monthly'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>
                </Field>
                <Field label="First day of any pay period" hint="Anchor for weekly / bi-weekly periods"><Input name="pay_period_anchor" type="date" defaultValue={s.pay_period_anchor} required /></Field>
                <Field label="Payday (days after period ends)"><Input name="payday_offset_days" type="number" min={0} max={31} defaultValue={s.payday_offset_days} /></Field>
              </div>
              <fieldset className="space-y-3 rounded-xl border border-stone-200 p-4">
                <legend className="px-1 text-sm font-semibold">Overtime</legend>
                <Checkbox name="overtime_enabled" defaultChecked={s.overtime_enabled} label="Calculate overtime" />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Weekly threshold (h)" hint="Blank = none"><Input name="overtime_weekly_threshold" type="number" step="0.25" defaultValue={s.overtime_weekly_threshold ?? ''} /></Field>
                  <Field label="Daily threshold (h)" hint="Blank = none"><Input name="overtime_daily_threshold" type="number" step="0.25" defaultValue={s.overtime_daily_threshold ?? ''} /></Field>
                  <Field label="Multiplier"><Input name="overtime_multiplier" type="number" step="0.05" min={1} defaultValue={s.overtime_multiplier} /></Field>
                </div>
                <p className="text-xs text-stone-500">Per-employee overrides live on each employee&apos;s Pay tab. Contractors never receive overtime.</p>
              </fieldset>
              <fieldset className="space-y-3 rounded-xl border border-stone-200 p-4">
                <legend className="px-1 text-sm font-semibold">Break policy</legend>
                <Checkbox name="auto_break_enabled" defaultChecked={s.auto_break_enabled} label="Automatically deduct an unpaid break on long shifts" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="When a shift is at least (h)"><Input name="auto_break_after_hours" type="number" step="0.25" defaultValue={s.auto_break_after_hours} /></Field>
                  <Field label="Deduct (minutes)"><Input name="auto_break_minutes" type="number" min={0} defaultValue={s.auto_break_minutes} /></Field>
                </div>
              </fieldset>
            </Section>
          )}

          {tab === 'attendance' && (
            <Section name="attendance">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default geofence radius (m)" hint="Properties can override"><Input name="default_geofence_m" type="number" min={10} max={5000} defaultValue={s.default_geofence_m} /></Field>
                <Field label="Late after (minutes past start)"><Input name="late_grace_minutes" type="number" min={0} defaultValue={s.late_grace_minutes} /></Field>
                <Field label="Missed clock-in alert after (min)"><Input name="missed_clock_in_minutes" type="number" min={1} defaultValue={s.missed_clock_in_minutes} /></Field>
                <Field label="Forgot clock-out alert after job end (min)"><Input name="forgot_clock_out_minutes" type="number" min={1} defaultValue={s.forgot_clock_out_minutes} /></Field>
                <Field label="Flag shifts longer than (h)"><Input name="max_shift_hours" type="number" step="0.5" defaultValue={s.max_shift_hours} /></Field>
                <Field label="Weekly hours alert (h)"><Input name="max_weekly_hours_alert" type="number" step="0.5" defaultValue={s.max_weekly_hours_alert} /></Field>
                <Field label="Minimum travel buffer (min)"><Input name="min_travel_buffer_minutes" type="number" min={0} defaultValue={s.min_travel_buffer_minutes} /></Field>
                <Field label="Average travel speed (km/h)" hint="Used for travel-time warnings"><Input name="avg_travel_speed_kmh" type="number" step="1" defaultValue={s.avg_travel_speed_kmh} /></Field>
              </div>
              <Checkbox name="require_before_after_photos" defaultChecked={s.require_before_after_photos} label="Require before & after photos to complete a job (exception allowed with a reason)" />
              <Field label="Location policy shown to cleaners before their first clock-in" hint="Employees must accept this before GPS is captured. Location is captured only at clock-in and clock-out.">
                <Textarea name="location_policy_text" rows={4} defaultValue={s.location_policy_text} required />
              </Field>
            </Section>
          )}

          {tab === 'notifications' && (
            <Section name="notifications">
              <Checkbox name="email_enabled" defaultChecked={s.notification_prefs?.email_enabled} label="Also send email for notifications (requires RESEND_API_KEY on the server)" />
              <div>
                <p className="mb-2 text-sm font-medium text-stone-700">Notify management when…</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EVENTS.map(([k, label]) => <Checkbox key={k} name={`ev_${k}`} defaultChecked={s.notification_prefs?.events?.[k] ?? true} label={label} />)}
                </div>
              </div>
              <p className="text-xs text-stone-500">Cleaners always receive notifications about their own jobs, timesheets, payroll and announcements. SMS / WhatsApp can be added later through the delivery outbox.</p>
            </Section>
          )}

          {tab === 'catalog' && (
            <Section name="catalog">
              <Field label="Job types (one per line)"><Textarea name="job_types" rows={6} defaultValue={(s.job_types ?? []).join('\n')} /></Field>
              <Field label="Service pricing (one per line)" hint="Format: Service | price | unit — prefills the price when scheduling">
                <Textarea name="service_pricing" rows={5} defaultValue={(s.service_pricing ?? []).map((p: any) => `${p.service} | ${p.price} | ${p.unit}`).join('\n')} placeholder="Standard Residential | 160 | per visit" />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium text-stone-700">Business operating hours</p>
                <div className="space-y-2">
                  {DAYS.map((d) => (
                    <div key={d} className="grid grid-cols-[60px_1fr_1fr] items-center gap-2">
                      <span className="text-sm capitalize">{d}</span>
                      <Input type="time" name={`${d}_open`} defaultValue={s.operating_hours?.[d]?.[0] ?? ''} />
                      <Input type="time" name={`${d}_close`} defaultValue={s.operating_hours?.[d]?.[1] ?? ''} />
                    </div>
                  ))}
                  <p className="text-xs text-stone-500">Leave both blank for closed days.</p>
                </div>
              </div>
            </Section>
          )}

          {tab === 'integrations' && <IntegrationsTab tz={s.timezone} />}

          {tab === 'roles' && (
            <div className="space-y-6">
              <Table>
                <thead><tr><Th>Role</Th><Th>What they can do</Th></tr></thead>
                <tbody>
                  {(roles ?? []).map((r: any) => (
                    <tr key={r.key}><Td className="font-medium">{r.name}</Td><Td className="text-sm">{r.description}
                      <div className="mt-1 flex flex-wrap gap-1">{Object.entries(r.permissions ?? {}).map(([k, v]) => <Badge key={k} tone={v === false || v === 'none' ? 'gray' : 'sage'}>{titleCase(k)}: {String(v)}</Badge>)}</div></Td></tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-sm text-stone-600">Permissions are enforced in the database (row-level security), so they apply no matter how data is accessed. Change a person&apos;s role from their profile:</p>
              <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 text-sm">
                {(staff ?? []).map((u: any) => (
                  <li key={u.id} className="flex items-center justify-between px-4 py-2">
                    <Link href={`/admin/employees/${u.id}?tab=pay`} className="hover:text-sage-700">{u.full_name}</Link>
                    <span className="flex gap-2"><Badge>{ROLE_LABEL[u.role_key as Role]}</Badge>{!u.is_active && <Badge tone="red">Inactive</Badge>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
      {tab === 'catalog' && <p className="mt-4 text-sm text-stone-500">Checklist templates are managed under <Link className="text-sage-700 underline" href="/admin/checklists">Checklists</Link>.</p>}
    </>
  );
}
