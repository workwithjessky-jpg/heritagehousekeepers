import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser, getSettings, isStaff } from '@/lib/auth';
import { fmtTime } from '@/lib/format';
import { toCsv, toXlsx, fileResponse, type Col } from '@/lib/export';

// GET /api/export/timesheets?format=csv|xlsx&from=&to=&employee=&status=&flagged=1
// Default export = approved/paid entries (payroll-ready). Pass status= to override.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || !isStaff(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const format = p.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const s = await getSettings();
  const supabase = await createClient();
  let q = supabase.from('timesheets')
    .select('*, user:users!timesheets_employee_id_fkey(full_name,email), job:cleaning_jobs(title,property:properties(name,address))')
    .order('work_date').order('clock_in_at').limit(20000);
  if (p.get('from')) q = q.gte('work_date', p.get('from')!);
  if (p.get('to')) q = q.lte('work_date', p.get('to')!);
  if (p.get('employee')) q = q.eq('employee_id', p.get('employee')!);
  if (p.get('status')) q = q.eq('status', p.get('status')!);
  else q = q.in('status', ['approved', 'paid']);
  if (p.get('flagged')) q = q.neq('flags', '{}');
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const showPay = me.role !== 'office_admin';
  const cols: Col[] = [
    { header: 'Employee', key: 'employee', width: 22 }, { header: 'Email', key: 'email', width: 26 },
    { header: 'Date', key: 'date' }, { header: 'Job', key: 'job', width: 30 }, { header: 'Property', key: 'property', width: 24 },
    { header: 'Clock in', key: 'in' }, { header: 'Clock out', key: 'out' }, { header: 'Break (min)', key: 'break' },
    { header: 'Hours', key: 'hours', numFmt: '0.00' },
    ...(showPay ? [{ header: 'Rate', key: 'rate', numFmt: '0.00' }, { header: 'Est. earnings', key: 'earnings', numFmt: '0.00' }] : []),
    { header: 'Status', key: 'status' }, { header: 'Flags', key: 'flags', width: 30 }, { header: 'Manual', key: 'manual' },
  ];
  const rows = (data ?? []).map((t: any) => ({
    employee: t.user?.full_name, email: t.user?.email, date: t.work_date, job: t.job?.title ?? 'Manual entry', property: t.job?.property?.name,
    in: fmtTime(t.clock_in_at, s.timezone), out: fmtTime(t.clock_out_at, s.timezone), break: t.break_minutes,
    hours: Number(t.total_hours), rate: Number(t.pay_rate), earnings: Number(t.estimated_earnings),
    status: t.status, flags: (t.flags ?? []).join('; '), manual: t.is_manual ? 'yes' : '',
  }));
  const name = `timesheets_${p.get('from') ?? 'all'}_${p.get('to') ?? ''}`.replace(/_$/, '');
  return format === 'csv'
    ? fileResponse(toCsv(cols, rows), name, 'csv')
    : fileResponse(await toXlsx('Timesheets', cols, rows, `${s.company_name} — timesheets ${p.get('from') ?? ''} to ${p.get('to') ?? ''}`), name, 'xlsx');
}
