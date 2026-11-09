import Link from 'next/link';
import { requireRole, STAFF, getSettings, ROLE_LABEL, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { weekRange } from '@/lib/queries';
import { fmtMoney, initials, titleCase, todayInTz } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Table, Th, Td, Badge, Field, Input, Select, Empty, Meter } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createEmployee } from '../_actions/people';

export const metadata = { title: 'Employees' };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const me = await requireRole(STAFF);
  const { show } = await searchParams;
  const s = await getSettings();
  const supabase = await createClient();
  const w = weekRange(s.timezone);
  const [{ data: users }, { data: weekJobs }] = await Promise.all([
    supabase.from('users').select('id,full_name,email,phone,role_key,is_active,employee_profiles(job_title,team,pay_rate,employment_status,hire_date,location_consent_at)').order('full_name'),
    supabase.from('job_assignments').select('employee_id, job:cleaning_jobs!inner(scheduled_start,scheduled_end,status)').gte('job.scheduled_start', w.from).lt('job.scheduled_start', w.to).neq('job.status', 'cancelled'),
  ]);
  const load = new Map<string, number>();
  (weekJobs ?? []).forEach((a: any) => load.set(a.employee_id, (load.get(a.employee_id) ?? 0) + (new Date(a.job.scheduled_end).getTime() - new Date(a.job.scheduled_start).getTime()) / 36e5));
  const list = ((users ?? []) as any[]).filter((u) => show === 'all' || u.is_active);
  const owner = me.role === 'owner';
  const canSeePay = me.role !== 'office_admin';

  return (
    <>
      <PageHeader title="Employees" subtitle={`${list.filter((u) => u.role_key === 'cleaner').length} cleaners · ${list.filter((u) => u.role_key !== 'cleaner').length} management`}
        actions={<Link href={show === 'all' ? '/admin/employees' : '/admin/employees?show=all'} className="text-sm text-sage-700 hover:underline">{show === 'all' ? 'Hide inactive' : 'Show inactive'}</Link>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          {list.length === 0 ? <Empty title="No employees yet" /> : (
            <Table>
              <thead><tr><Th>Name</Th><Th>Role / title</Th><Th>Team</Th><Th>Status</Th>{canSeePay && <Th>Rate</Th>}<Th>Scheduled this week</Th></tr></thead>
              <tbody>
                {list.map((u) => {
                  const p = u.employee_profiles ?? {};
                  const h = load.get(u.id) ?? 0;
                  return (
                    <tr key={u.id} className="hover:bg-stone-50">
                      <Td>
                        <Link href={`/admin/employees/${u.id}`} className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-full bg-sage-100 text-xs font-semibold text-sage-800">{initials(u.full_name)}</span>
                          <span><span className="font-medium text-ink">{u.full_name}</span><span className="block text-xs text-stone-500">{u.email}</span></span>
                        </Link>
                      </Td>
                      <Td>{ROLE_LABEL[u.role_key as Role]}<div className="text-xs text-stone-500">{p.job_title}</div></Td>
                      <Td>{p.team ?? '—'}</Td>
                      <Td>{!u.is_active ? <Badge tone="red">Inactive</Badge> : <Badge tone={p.employment_status === 'active' ? 'green' : 'amber'}>{titleCase(p.employment_status)}</Badge>}
                        {u.role_key === 'cleaner' && !p.location_consent_at && <div className="mt-1"><Badge tone="gray">Location policy not accepted</Badge></div>}</Td>
                      {canSeePay && <Td className="tabular-nums">{fmtMoney(p.pay_rate, s.currency)}/h</Td>}
                      <Td className="min-w-36">{u.role_key === 'cleaner' ? <><span className="text-sm tabular-nums">{h.toFixed(1)} h</span><Meter value={h} max={s.max_weekly_hours_alert} className="mt-1" /></> : '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        {owner ? (
          <Card>
            <CardHeader title="Add employee" subtitle="Creates their personal login" />
            <CardBody>
              <ActionForm action={createEmployee} resetOnSuccess redirectTo="/admin/employees/{id}" className="space-y-3">
                <Field label="Full name"><Input name="full_name" required /></Field>
                <Field label="Email (their username)"><Input name="email" type="email" required /></Field>
                <Field label="Phone"><Input name="phone" type="tel" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Role">
                    <Select name="role" defaultValue="cleaner">
                      {(['cleaner', 'office_admin', 'ops_manager', 'owner'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Hourly rate"><Input name="pay_rate" type="number" step="0.01" min="0" placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Job title"><Input name="job_title" placeholder="Housekeeper" /></Field>
                  <Field label="Team"><Input name="team" placeholder="e.g. North" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hire date"><Input name="hire_date" type="date" defaultValue={todayInTz(s.timezone)} /></Field>
                  <Field label="Employment type">
                    <Select name="employment_type" defaultValue="hourly_employee">
                      <option value="hourly_employee">Hourly employee</option><option value="part_time">Part-time</option><option value="seasonal">Seasonal</option><option value="contractor">Contractor</option><option value="salaried">Salaried</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Temporary password (optional)" hint="Leave blank to email an invitation link instead (requires email set up in Supabase).">
                  <Input name="temp_password" type="text" minLength={10} autoComplete="off" />
                </Field>
                <SubmitButton className="w-full" pendingText="Creating login…">Create employee</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : (
          <Card className="h-fit p-5 text-sm text-stone-600">Only the owner can create logins or change pay rates and roles.</Card>
        )}
      </div>
    </>
  );
}
