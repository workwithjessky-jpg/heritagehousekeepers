import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { currentPeriod } from '@/lib/queries';
import { todayInTz, addDays, fmtTime, fmtMoney, fmtDateTime, fmtPlainDate } from '@/lib/format';
import { Card, CardHeader, PageHeader, Input, Select, Empty, Tabs, StatusBadge, TS_STATUS, REQ_STATUS, Table, Th, Td, buttonClass } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { BulkTable, type Row } from './bulk-table';
import { reviewCorrection } from '../_actions/pay';

export const metadata = { title: 'Timesheets' };

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireRole(STAFF);
  const sp = await searchParams;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const period = await currentPeriod(tz);
  const tab = sp.tab ?? 'entries';
  const from = sp.from || period?.start_date || addDays(todayInTz(tz), -14);
  const to = sp.to || period?.end_date || todayInTz(tz);

  const { data: cleaners } = await supabase.from('users').select('id,full_name').neq('role_key', 'owner').order('full_name');
  const { count: pendingCorr } = await supabase.from('timesheet_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const qs = new URLSearchParams(Object.entries({ from, to, employee: sp.employee, status: sp.status, flagged: sp.flagged }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader title="Timesheets" subtitle="Every clock-out creates an entry automatically. Review, adjust and approve them for payroll."
        actions={<>
          <a className={buttonClass('secondary')} href={`/api/export/timesheets?format=csv&${qs}`}><Download className="size-4" />CSV</a>
          <a className={buttonClass('secondary')} href={`/api/export/timesheets?format=xlsx&${qs}`}><Download className="size-4" />Excel</a>
        </>} />
      <Tabs active={tab} tabs={[
        { key: 'entries', label: 'Entries', href: '/admin/timesheets' },
        { key: 'corrections', label: `Correction requests${pendingCorr ? ` (${pendingCorr})` : ''}`, href: '/admin/timesheets?tab=corrections' },
      ]} />
      {tab === 'corrections'
        ? <Corrections tz={tz} canDecide={isSupervisor(me.role)} />
        : <Entries sp={sp} from={from} to={to} tz={tz} cleaners={cleaners ?? []} canApprove={isSupervisor(me.role)} currency={s.currency} showPay={me.role !== 'office_admin'} />}
    </>
  );
}

async function Entries({ sp, from, to, tz, cleaners, canApprove, currency, showPay }: any) {
  const supabase = await createClient();
  let q = supabase.from('timesheets')
    .select('*, user:users!timesheets_employee_id_fkey(full_name), job:cleaning_jobs(title)')
    .gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).order('clock_in_at', { ascending: false }).limit(1000);
  if (sp.employee) q = q.eq('employee_id', sp.employee);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.flagged) q = q.neq('flags', '{}');
  const { data } = await q;
  const list = (data ?? []) as any[];
  const totals = list.reduce((a, t) => ({ hours: a.hours + Number(t.total_hours), pay: a.pay + Number(t.estimated_earnings) }), { hours: 0, pay: 0 });
  const rows: Row[] = list.map((t) => ({
    id: t.id, employee: t.user?.full_name, employee_id: t.employee_id, date: fmtPlainDate(t.work_date, { weekday: 'short', year: undefined }),
    job: t.job?.title ?? null, job_id: t.job_id, inLabel: fmtTime(t.clock_in_at, tz), outLabel: fmtTime(t.clock_out_at, tz),
    break_minutes: t.break_minutes, total_hours: t.total_hours, pay_rate: t.pay_rate, earnings: fmtMoney(t.estimated_earnings, currency),
    status: t.status, flags: t.flags, is_manual: t.is_manual, notes: t.employee_notes, review_notes: t.review_notes, editable: t.status !== 'paid',
  }));

  return (
    <>
      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-2" action="/admin/timesheets">
          <label className="text-xs text-stone-500">From<Input type="date" name="from" defaultValue={from} className="w-40" /></label>
          <label className="text-xs text-stone-500">To<Input type="date" name="to" defaultValue={to} className="w-40" /></label>
          <Select name="employee" defaultValue={sp.employee ?? ''} className="w-48">
            <option value="">All employees</option>{cleaners.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </Select>
          <Select name="status" defaultValue={sp.status ?? ''} className="w-40">
            <option value="">All statuses</option>{Object.entries(TS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <label className="flex items-center gap-2 px-2 text-sm text-stone-600"><input type="checkbox" name="flagged" value="1" defaultChecked={!!sp.flagged} className="accent-sage-700" />Flagged only</label>
          <button className={buttonClass('secondary')}>Apply</button>
          <Link href="/admin/timesheets" className="text-sm text-stone-500 hover:underline">Current pay period</Link>
        </form>
        <p className="mt-3 text-sm text-stone-600">
          {list.length} entries · <b>{totals.hours.toFixed(2)} h</b>{showPay && <> · est. gross <b>{fmtMoney(totals.pay, currency)}</b></>}
          {' '}· flagged entries need a look before approval.
        </p>
      </Card>
      <Card>
        {rows.length === 0 ? <Empty title="No timesheet entries for these filters" /> : <BulkTable rows={rows} canApprove={canApprove} showPay={showPay} />}
      </Card>
    </>
  );
}

async function Corrections({ tz, canDecide }: { tz: string; canDecide: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from('timesheet_adjustments')
    .select('*, employee:users!timesheet_adjustments_employee_id_fkey(full_name), requester:users!timesheet_adjustments_requested_by_fkey(full_name), job:cleaning_jobs(title)')
    .order('created_at', { ascending: false }).limit(200);
  const list = (data ?? []) as any[];
  return (
    <Card>
      <CardHeader title="Corrections & audit trail" subtitle="Employee requests for missed punches / wrong times, plus every manager edit." />
      {list.length === 0 ? <Empty title="No corrections yet" /> : (
        <Table>
          <thead><tr><Th>Requested</Th><Th>Employee</Th><Th>Type</Th><Th>Change</Th><Th>Reason</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(a.created_at, tz)}<div className="text-xs text-stone-500">by {a.requester?.full_name}</div></Td>
                <Td className="font-medium text-ink">{a.employee?.full_name}{a.job && <div className="text-xs font-normal text-stone-500">{a.job.title}</div>}</Td>
                <Td>{a.kind === 'manager_edit' ? 'Manager edit' : a.kind === 'missed_punch_request' ? 'Missed punch' : 'Correction'}</Td>
                <Td className="text-xs">
                  {a.old_values && <div className="text-stone-500 line-through">{fmtDateTime(a.old_values.clock_in_at, tz)} – {fmtTime(a.old_values.clock_out_at, tz)}</div>}
                  <div>{fmtDateTime(a.new_values.clock_in_at, tz)} – {fmtTime(a.new_values.clock_out_at, tz)} · {a.new_values.break_minutes ?? 0}m break</div>
                </Td>
                <Td className="max-w-56 text-sm">{a.reason}{a.review_notes && <div className="text-xs text-stone-500">Review: {a.review_notes}</div>}</Td>
                <Td><StatusBadge map={REQ_STATUS} value={a.status} /></Td>
                <Td>
                  {a.status === 'pending' && canDecide && (
                    <ActionForm action={reviewCorrection} className="flex flex-col gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      <Input name="notes" placeholder="Note" className="h-8 text-xs" />
                      <div className="flex gap-1">
                        <SubmitButton name="decision" value="approve" size="sm" variant="success">Approve</SubmitButton>
                        <SubmitButton name="decision" value="reject" size="sm" variant="danger">Reject</SubmitButton>
                      </div>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
