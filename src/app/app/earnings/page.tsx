import { Info } from 'lucide-react';
import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { currentPeriod } from '@/lib/queries';
import { fmtMoney, fmtPlainDate } from '@/lib/format';
import { Card, CardHeader, CardBody, StatusBadge, PAYROLL_STATUS, Empty } from '@/components/ui';

export const metadata = { title: 'My pay' };

export default async function CleanerEarnings() {
  const me = await requireRole(['cleaner']);
  const s = await getSettings();
  const supabase = await createClient();
  const period = await currentPeriod(s.timezone);
  const [{ data: ts }, { data: profile }, { data: history }] = await Promise.all([
    period ? supabase.from('timesheets').select('total_hours,estimated_earnings,status,work_date').gte('work_date', period.start_date).lte('work_date', period.end_date) : Promise.resolve({ data: [] }),
    supabase.from('employee_profiles').select('pay_rate,overtime_eligible,employment_type').eq('user_id', me.id).single(),
    supabase.from('payroll_records').select('*, period:payroll_periods(start_date,end_date,pay_date,status)').order('created_at', { ascending: false }).limit(26),
  ]);
  const list = ((ts ?? []) as any[]).filter((t) => t.status !== 'rejected');
  const sum = (l: any[], k: string) => l.reduce((a, t) => a + Number(t[k]), 0);
  const approved = list.filter((t) => ['approved', 'paid'].includes(t.status));
  const pending = list.filter((t) => !['approved', 'paid'].includes(t.status));
  const total = sum(list, 'total_hours');
  const rate = Number(profile?.pay_rate ?? 0);
  // live overtime preview using the configured weekly threshold (final figures come from payroll)
  const thr = s.overtime_enabled && profile?.overtime_eligible && profile?.employment_type !== 'contractor' ? s.overtime_weekly_threshold : null;
  const byWeek = new Map<string, number>();
  list.forEach((t) => { const d = new Date(t.work_date + 'T00:00:00Z'); const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); byWeek.set(mon, (byWeek.get(mon) ?? 0) + Number(t.total_hours)); });
  const ot = thr ? [...byWeek.values()].reduce((a, h) => a + Math.max(0, h - Number(thr)), 0) : 0;
  const reg = total - ot;
  const mult = Number(s.overtime_multiplier ?? 1.5);
  const gross = reg * rate + ot * rate * mult;
  const current = (history ?? []).find((h: any) => h.period?.start_date === period?.start_date);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">My pay</h1>
      {period && (
        <Card>
          <CardHeader title="This pay period" subtitle={`${fmtPlainDate(period.start_date, { year: undefined })} – ${fmtPlainDate(period.end_date)} · payday ${fmtPlainDate(period.pay_date, { weekday: 'short', year: undefined })}`} />
          <CardBody className="p-0">
            <table className="w-full text-[15px]">
              <tbody className="divide-y divide-stone-100">
                <Row label="Total hours" value={total.toFixed(2)} />
                <Row label="Regular hours" value={reg.toFixed(2)} />
                {thr && <Row label={`Overtime hours (×${mult})`} value={ot.toFixed(2)} />}
                <Row label="Hourly rate" value={fmtMoney(rate, s.currency)} />
                <Row label="Regular earnings" value={fmtMoney(reg * rate, s.currency)} />
                {thr && <Row label="Overtime earnings" value={fmtMoney(ot * rate * mult, s.currency)} />}
                <Row label="Approved hours" value={sum(approved, 'total_hours').toFixed(2)} />
                <Row label="Pending approval" value={sum(pending, 'total_hours').toFixed(2)} />
                <tr className="bg-sage-50"><td className="px-5 py-3 font-semibold">Estimated gross pay</td><td className="px-5 py-3 text-right text-lg font-semibold tabular-nums">{fmtMoney(current?.gross_pay ?? gross, s.currency)}</td></tr>
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
      <div className="flex gap-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>This is an <b>estimate of gross pay</b> before taxes and deductions. Your actual take-home (net) pay is shown on your official pay stub.</p>
      </div>
      <Card>
        <CardHeader title="Payroll history" />
        {(history ?? []).length === 0 ? <Empty title="No processed payroll yet" /> : (
          <ul className="divide-y divide-stone-100">
            {(history as any[]).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="font-medium text-ink">{fmtPlainDate(h.period?.start_date, { year: undefined })} – {fmtPlainDate(h.period?.end_date)}</div>
                  <div className="text-sm text-stone-500">{(Number(h.regular_hours) + Number(h.overtime_hours)).toFixed(2)} h{Number(h.overtime_hours) > 0 && ` (${h.overtime_hours} OT)`} · payday {fmtPlainDate(h.period?.pay_date, { year: undefined })}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{fmtMoney(h.gross_pay, s.currency)}</div>
                  <StatusBadge map={PAYROLL_STATUS} value={h.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <tr><td className="px-5 py-2.5 text-stone-600">{label}</td><td className="px-5 py-2.5 text-right tabular-nums">{value}</td></tr>;
}
