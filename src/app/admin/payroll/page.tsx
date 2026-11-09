import Link from 'next/link';
import { Info } from 'lucide-react';
import { requireRole, SUPERVISORS, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { currentPeriod } from '@/lib/queries';
import { todayInTz, fmtMoney, fmtPlainDate, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Table, Th, Td, StatusBadge, PAYROLL_STATUS, Empty, Input, Stat } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { openPeriod } from '../_actions/pay';

export const metadata = { title: 'Payroll' };

export default async function PayrollPage() {
  const me = await requireRole(SUPERVISORS);
  const s = await getSettings();
  const supabase = await createClient();
  const cur = await currentPeriod(s.timezone);
  const [{ data: periods }, { data: records }, { data: curTs }] = await Promise.all([
    supabase.from('payroll_periods').select('*').order('start_date', { ascending: false }).limit(36),
    supabase.from('payroll_records').select('period_id,gross_pay,regular_hours,overtime_hours'),
    cur ? supabase.from('timesheets').select('total_hours,estimated_earnings,status').gte('work_date', cur.start_date).lte('work_date', cur.end_date) : Promise.resolve({ data: [] }),
  ]);
  const byPeriod = new Map<string, { gross: number; hours: number; n: number }>();
  (records ?? []).forEach((r: any) => {
    const v = byPeriod.get(r.period_id) ?? { gross: 0, hours: 0, n: 0 };
    byPeriod.set(r.period_id, { gross: v.gross + Number(r.gross_pay), hours: v.hours + Number(r.regular_hours) + Number(r.overtime_hours), n: v.n + 1 });
  });
  const ts = (curTs ?? []) as any[];
  const approved = ts.filter((t) => ['approved', 'paid'].includes(t.status));
  const pending = ts.filter((t) => ['draft', 'submitted', 'under_review'].includes(t.status));
  const sum = (l: any[], k: string) => l.reduce((a, t) => a + Number(t[k]), 0);
  const isOwner = me.role === 'owner';

  return (
    <>
      <PageHeader title="Payroll" subtitle={`Pay frequency: ${titleCase(s.pay_frequency)} · Jurisdiction: ${s.jurisdiction} · Overtime ${s.overtime_enabled ? 'on' : 'off'}`} />

      <div className="mb-4 flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>Figures are <b>estimated gross pay</b> from approved hours and your configured rules. Taxes are <b>not</b> calculated here; net pay is only estimated when deductions are explicitly configured on an employee. Run final pay through your payroll provider, then mark the period paid.</p>
      </div>

      {cur && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Current period" value={<span className="text-lg">{fmtPlainDate(cur.start_date, { year: undefined })} – {fmtPlainDate(cur.end_date, { year: undefined })}</span>} hint={`Payday ${fmtPlainDate(cur.pay_date)}`} />
          <Stat label="Approved hours" value={sum(approved, 'total_hours').toFixed(1)} hint={fmtMoney(sum(approved, 'estimated_earnings'), s.currency) + ' est. gross'} tone="good" />
          <Stat label="Pending approval" value={sum(pending, 'total_hours').toFixed(1)} hint={`${pending.length} entries`} tone={pending.length ? 'warn' : 'default'} href="/admin/timesheets?status=submitted" />
          <Stat label="Est. labor cost (all)" value={fmtMoney(sum(ts.filter((t) => t.status !== 'rejected'), 'estimated_earnings'), s.currency)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Pay periods" />
          {(periods ?? []).length === 0 ? <Empty title="No payroll runs yet">{isOwner ? 'Open the current period to calculate payroll.' : 'The owner has not run payroll yet.'}</Empty> : (
            <Table>
              <thead><tr><Th>Period</Th><Th>Pay date</Th><Th>Employees</Th><Th>Hours</Th><Th>Est. gross</Th><Th>Status</Th></tr></thead>
              <tbody>
                {(periods as any[]).map((p) => {
                  const v = byPeriod.get(p.id);
                  return (
                    <tr key={p.id} className="hover:bg-stone-50">
                      <Td><Link href={`/admin/payroll/${p.id}`} className="font-medium text-ink hover:text-sage-700">{fmtPlainDate(p.start_date, { year: undefined })} – {fmtPlainDate(p.end_date)}</Link></Td>
                      <Td>{fmtPlainDate(p.pay_date)}</Td>
                      <Td>{v?.n ?? 0}</Td>
                      <Td className="tabular-nums">{(v?.hours ?? 0).toFixed(1)}</Td>
                      <Td className="tabular-nums">{fmtMoney(v?.gross ?? 0, s.currency)}</Td>
                      <Td><StatusBadge map={PAYROLL_STATUS} value={p.status} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        {isOwner && (
          <Card>
            <CardHeader title="Run payroll" subtitle="Pick any date inside the period" />
            <CardBody>
              <ActionForm action={openPeriod} redirectTo="/admin/payroll/{id}" className="space-y-3">
                <Input type="date" name="date" defaultValue={todayInTz(s.timezone)} required />
                <SubmitButton className="w-full">Open pay period</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-xs text-stone-500">Period boundaries follow Settings → Payroll (frequency and anchor date).</p>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
