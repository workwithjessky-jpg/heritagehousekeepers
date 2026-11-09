import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser, getSettings, isSupervisor } from '@/lib/auth';
import { toCsv, toXlsx, fileResponse, type Col } from '@/lib/export';

// GET /api/export/payroll/:periodId?format=csv|xlsx — owner & operations managers
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me || !isSupervisor(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const format = req.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const s = await getSettings();
  const supabase = await createClient();
  const { data: period } = await supabase.from('payroll_periods').select('*').eq('id', id).single();
  if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data } = await supabase.from('payroll_records').select('*, user:users(full_name,email)').eq('period_id', id).order('gross_pay', { ascending: false });

  const money = '0.00';
  const cols: Col[] = [
    { header: 'Employee', key: 'employee', width: 22 }, { header: 'Email', key: 'email', width: 26 },
    { header: 'Regular hours', key: 'reg', numFmt: money }, { header: 'Overtime hours', key: 'ot', numFmt: money },
    { header: 'Hourly rate', key: 'rate', numFmt: money }, { header: 'OT multiplier', key: 'mult' },
    { header: 'Regular pay', key: 'regPay', numFmt: money }, { header: 'Overtime pay', key: 'otPay', numFmt: money },
    { header: 'Adjustments', key: 'adj', numFmt: money }, { header: 'Estimated gross', key: 'gross', numFmt: money },
    { header: 'Configured deductions', key: 'ded', numFmt: money }, { header: 'Deduction detail', key: 'dedDetail', width: 30 },
    { header: 'Estimated net (excl. taxes)', key: 'net', numFmt: money }, { header: 'Pending hours (excluded)', key: 'pending', numFmt: money },
    { header: 'Discrepancies', key: 'disc', width: 40 }, { header: 'Status', key: 'status' },
  ];
  const rows = (data ?? []).map((r: any) => ({
    employee: r.user?.full_name, email: r.user?.email, reg: Number(r.regular_hours), ot: Number(r.overtime_hours), rate: Number(r.hourly_rate),
    mult: Number(r.overtime_multiplier), regPay: Number(r.regular_pay), otPay: Number(r.overtime_pay), adj: Number(r.adjustments_total),
    gross: Number(r.gross_pay), ded: Number(r.deductions_total),
    dedDetail: (r.deductions_detail ?? []).map((d: any) => `${d.name}: ${d.amount}`).join('; '),
    net: r.net_pay_estimate == null ? 'not configured' : Number(r.net_pay_estimate), pending: Number(r.pending_hours),
    disc: (r.discrepancies ?? []).join('; '), status: r.status,
  }));
  const name = `payroll_${period.start_date}_${period.end_date}`;
  const title = `${s.company_name} — payroll ${period.start_date} to ${period.end_date} (pay date ${period.pay_date}) · ESTIMATED GROSS, no tax withholding`;
  return format === 'csv' ? fileResponse(toCsv(cols, rows), name, 'csv') : fileResponse(await toXlsx('Payroll', cols, rows, title), name, 'xlsx');
}
