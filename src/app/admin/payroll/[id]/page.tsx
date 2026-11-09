import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, TriangleAlert } from 'lucide-react';
import { requireRole, SUPERVISORS, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtMoney, fmtPlainDate, fmtDateTime, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Table, Th, Td, StatusBadge, PAYROLL_STATUS, Empty, Input, Select, Badge, buttonClass, Meter } from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import { generatePayroll, approvePayroll, markPaid, addPayrollAdjustment } from '../../_actions/pay';

export const metadata = { title: 'Payroll period' };

export default async function PayrollPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(SUPERVISORS);
  const { id } = await params;
  const s = await getSettings();
  const supabase = await createClient();
  const { data: period } = await supabase.from('payroll_periods').select('*').eq('id', id).single();
  if (!period) notFound();
  const [{ data: recs }, { data: adjustments }, { data: unapproved }] = await Promise.all([
    supabase.from('payroll_records').select('*, user:users(full_name)').eq('period_id', id).order('gross_pay', { ascending: false }),
    supabase.from('payroll_adjustments').select('*, record:payroll_records!inner(period_id,employee_id)').eq('record.period_id', id),
    supabase.from('timesheets').select('id,employee_id,total_hours,status').gte('work_date', period.start_date).lte('work_date', period.end_date).in('status', ['draft', 'submitted', 'under_review', 'rejected']),
  ]);
  const list = (recs ?? []) as any[];
  const owner = me.role === 'owner';
  const locked = ['approved', 'paid'].includes(period.status);
  const tot = list.reduce((a, r) => ({
    reg: a.reg + Number(r.regular_hours), ot: a.ot + Number(r.overtime_hours), gross: a.gross + Number(r.gross_pay),
    ded: a.ded + Number(r.deductions_total), otPay: a.otPay + Number(r.overtime_pay),
  }), { reg: 0, ot: 0, gross: 0, ded: 0, otPay: 0 });
  const maxGross = Math.max(1, ...list.map((r) => Number(r.gross_pay)));
  const discrepancies = list.filter((r) => r.discrepancies?.length);
  const unapprovedHours = (unapproved ?? []).reduce((a: number, t: any) => a + Number(t.total_hours), 0);

  return (
    <>
      <PageHeader
        title={`Payroll · ${fmtPlainDate(period.start_date, { year: undefined })} – ${fmtPlainDate(period.end_date)}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">Pay date {fmtPlainDate(period.pay_date)} <StatusBadge map={PAYROLL_STATUS} value={period.status} />
          {period.generated_at && <span className="text-stone-400">· calculated {fmtDateTime(period.generated_at, s.timezone)}</span>}</span>}
        actions={<>
          <a className={buttonClass('secondary')} href={`/api/export/payroll/${id}?format=csv`}><Download className="size-4" />CSV</a>
          <a className={buttonClass('secondary')} href={`/api/export/payroll/${id}?format=xlsx`}><Download className="size-4" />Excel</a>
        </>}
      />

      {owner && (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <ol className="flex flex-1 flex-wrap items-center gap-2 text-sm text-stone-600">
              {['open', 'generated', 'approved', 'paid'].map((st, i) => (
                <li key={st} className="flex items-center gap-2">
                  <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${['open', 'generated', 'approved', 'paid'].indexOf(period.status) >= i ? 'bg-sage-700 text-white' : 'bg-stone-200'}`}>{i + 1}</span>
                  {['Open', 'Calculate', 'Approve', 'Mark paid'][i]}{i < 3 && <span className="text-stone-300">→</span>}
                </li>
              ))}
            </ol>
            {!locked && <ActionButton action={generatePayroll} fields={{ period_id: id }} variant="primary" size="md">{period.status === 'open' ? 'Calculate payroll' : 'Recalculate'}</ActionButton>}
            {period.status === 'generated' && <ActionButton action={approvePayroll} fields={{ period_id: id }} variant="success" size="md" confirm="Approve payroll? Employees will be notified of their estimated gross pay and the period will be locked.">Approve payroll</ActionButton>}
            {period.status === 'approved' && <ActionButton action={markPaid} fields={{ period_id: id }} variant="success" size="md" confirm="Only mark paid after the money has actually been sent. Continue?">Mark as paid</ActionButton>}
          </div>
          {unapprovedHours > 0 && !locked && (
            <p className="mt-3 flex items-center gap-2 text-sm text-amber-800"><TriangleAlert className="size-4" />{unapprovedHours.toFixed(2)} hours in this period are not approved yet and are excluded. <Link className="underline" href={`/admin/timesheets?from=${period.start_date}&to=${period.end_date}&status=submitted`}>Review timesheets</Link></p>
          )}
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="p-4"><div className="text-[13px] text-stone-500">Employees</div><div className="text-2xl font-semibold">{list.length}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Regular hours</div><div className="text-2xl font-semibold tabular-nums">{tot.reg.toFixed(2)}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Overtime hours</div><div className="text-2xl font-semibold tabular-nums">{tot.ot.toFixed(2)}</div><div className="text-xs text-stone-500">{fmtMoney(tot.otPay, s.currency)}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Estimated gross</div><div className="text-2xl font-semibold tabular-nums">{fmtMoney(tot.gross, s.currency)}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Configured deductions</div><div className="text-2xl font-semibold tabular-nums">{fmtMoney(tot.ded, s.currency)}</div><div className="text-xs text-stone-500">No tax withholding</div></Card>
      </div>

      {discrepancies.length > 0 && (
        <Card className="mb-6 border-amber-200">
          <CardHeader title="Discrepancies to review" subtitle="Resolve or accept before approving" />
          <ul className="divide-y divide-stone-100 text-sm">
            {discrepancies.map((r) => <li key={r.id} className="px-5 py-2.5"><b>{r.user?.full_name}:</b> {r.discrepancies.join(' · ')}</li>)}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Employee summary" />
        {list.length === 0 ? <Empty title={period.status === 'open' ? 'Not calculated yet' : 'No approved hours in this period'} /> : (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Reg h</Th><Th>OT h</Th><Th>Rate</Th><Th>Regular</Th><Th>Overtime</Th><Th>Adj.</Th><Th>Est. gross</Th><Th>Deductions</Th><Th>Est. net*</Th>{owner && !locked && <Th>Add adjustment</Th>}</tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-ink"><Link className="hover:text-sage-700" href={`/admin/employees/${r.employee_id}`}>{r.user?.full_name}</Link><div className="text-xs font-normal text-stone-500">{r.timesheet_count} entries{Number(r.pending_hours) > 0 && ` · ${r.pending_hours} h pending`}</div></Td>
                  <Td className="tabular-nums">{Number(r.regular_hours).toFixed(2)}</Td>
                  <Td className="tabular-nums">{Number(r.overtime_hours).toFixed(2)}{Number(r.overtime_hours) > 0 && <div className="text-xs text-stone-500">×{r.overtime_multiplier}</div>}</Td>
                  <Td className="tabular-nums">{fmtMoney(r.hourly_rate, s.currency)}</Td>
                  <Td className="tabular-nums">{fmtMoney(r.regular_pay, s.currency)}</Td>
                  <Td className="tabular-nums">{fmtMoney(r.overtime_pay, s.currency)}</Td>
                  <Td className="tabular-nums">{fmtMoney(r.adjustments_total, s.currency)}
                    {(adjustments ?? []).filter((a: any) => a.payroll_record_id === r.id).map((a: any) => <div key={a.id} className="text-xs text-stone-500">{titleCase(a.kind)}: {a.description} ({fmtMoney(a.amount, s.currency)})</div>)}
                  </Td>
                  <Td className="min-w-32 font-semibold tabular-nums">{fmtMoney(r.gross_pay, s.currency)}<Meter value={Number(r.gross_pay)} max={maxGross} className="mt-1" /></Td>
                  <Td className="tabular-nums">{fmtMoney(r.deductions_total, s.currency)}{(r.deductions_detail ?? []).map((d: any) => <div key={d.name} className="text-xs text-stone-500">{d.name}: {fmtMoney(d.amount, s.currency)}</div>)}</Td>
                  <Td className="tabular-nums">{r.net_pay_estimate != null ? fmtMoney(r.net_pay_estimate, s.currency) : <Badge>Not configured</Badge>}</Td>
                  {owner && !locked && (
                    <Td>
                      <ActionForm action={addPayrollAdjustment} className="flex min-w-72 flex-wrap gap-1">
                        <input type="hidden" name="record_id" value={r.id} />
                        <Select name="kind" className="h-8 w-28 text-xs"><option value="bonus">Bonus</option><option value="reimbursement">Reimburse</option><option value="correction">Correction</option><option value="deduction">Deduction</option></Select>
                        <Input name="amount" type="number" step="0.01" placeholder="$" className="h-8 w-20 text-xs" required />
                        <Input name="description" placeholder="Reason" className="h-8 w-28 text-xs" required />
                        <SubmitButton size="sm" variant="secondary">Add</SubmitButton>
                      </ActionForm>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <CardBody className="text-xs text-stone-500">* Estimated net subtracts only the deductions configured on each employee profile. It does not include taxes or statutory withholdings.</CardBody>
      </Card>
    </>
  );
}
