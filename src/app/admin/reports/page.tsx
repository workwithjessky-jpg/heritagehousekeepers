import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireRole, SUPERVISORS, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rangeUtc } from '@/lib/queries';
import { addDays, fmtMoney, todayInTz, fmtPlainDate, titleCase } from '@/lib/format';
import { Card, CardHeader, PageHeader, Table, Th, Td, Input, Select, Stat, Meter, Empty, buttonClass, JOB_STATUS } from '@/components/ui';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(SUPERVISORS);
  const sp = await searchParams;
  const s = await getSettings();
  const tz = s.timezone;
  const cur = s.currency;
  const today = todayInTz(tz);
  const from = sp.from || addDays(today, -29);
  const to = sp.to || today;
  const r = rangeUtc(from, addDays(to, 1), tz);
  const supabase = await createClient();

  let jq = supabase.from('cleaning_jobs')
    .select('id,title,status,price,scheduled_start,scheduled_end,client_id,property_id,client:clients(name),property:properties(name),job_assignments(employee_id),attendance_records(total_minutes,flags)')
    .gte('scheduled_start', r.from).lt('scheduled_start', r.to);
  if (sp.client) jq = jq.eq('client_id', sp.client);
  if (sp.property) jq = jq.eq('property_id', sp.property);
  if (sp.status) jq = jq.eq('status', sp.status);
  let tq = supabase.from('timesheets').select('employee_id,job_id,total_hours,estimated_earnings,status,flags,work_date').gte('work_date', from).lte('work_date', to).neq('status', 'rejected');
  if (sp.employee) tq = tq.eq('employee_id', sp.employee);
  let aq = supabase.from('attendance_records').select('employee_id,flags,clock_in_location').gte('clock_in_at', r.from).lt('clock_in_at', r.to);
  if (sp.employee) aq = aq.eq('employee_id', sp.employee);

  const [{ data: jobsRaw }, { data: ts }, { data: att }, { data: people }, { data: clients }, { data: props }, { data: payroll }] = await Promise.all([
    jq, tq, aq,
    supabase.from('users').select('id,full_name,employee_profiles(team)').eq('role_key', 'cleaner').order('full_name'),
    supabase.from('clients').select('id,name').order('name'),
    supabase.from('properties').select('id,name').order('name'),
    supabase.from('payroll_periods').select('id,start_date,end_date,status,payroll_records(gross_pay)').gte('end_date', from).lte('start_date', to).order('start_date'),
  ]);
  const teamIds = sp.team ? new Set((people ?? []).filter((p: any) => p.employee_profiles?.team === sp.team).map((p: any) => p.id)) : null;
  let jobs = (jobsRaw ?? []) as any[];
  if (sp.employee) jobs = jobs.filter((j) => j.job_assignments.some((a: any) => a.employee_id === sp.employee));
  if (teamIds) jobs = jobs.filter((j) => j.job_assignments.some((a: any) => teamIds.has(a.employee_id)));
  const tsl = ((ts ?? []) as any[]).filter((t) => !teamIds || teamIds.has(t.employee_id));
  const attl = ((att ?? []) as any[]).filter((a) => !teamIds || teamIds.has(a.employee_id));

  const completed = jobs.filter((j) => j.status === 'completed');
  const revenue = completed.reduce((a, j) => a + Number(j.price ?? 0), 0);
  const laborHours = tsl.reduce((a, t) => a + Number(t.total_hours), 0);
  const laborCost = tsl.reduce((a, t) => a + Number(t.estimated_earnings), 0);
  const durations = completed.map((j) => (j.attendance_records ?? []).reduce((a: number, x: any) => a + (x.total_minutes ?? 0), 0)).filter((m) => m > 0);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length / 60 : 0;
  const scheduledHours = jobs.filter((j) => j.status !== 'cancelled').reduce((a, j) => a + (new Date(j.scheduled_end).getTime() - new Date(j.scheduled_start).getTime()) / 36e5 * Math.max(1, j.job_assignments.length), 0);
  const onTime = attl.length ? attl.filter((a) => !a.flags?.includes('late_clock_in')).length / attl.length : null;
  const inFence = attl.length ? attl.filter((a) => a.clock_in_location === 'verified').length / attl.length : null;

  // by employee
  const emp = new Map<string, { hours: number; cost: number; jobs: Set<string>; shifts: number; late: number; outside: number; scheduled: number }>();
  const E = (id: string) => emp.get(id) ?? emp.set(id, { hours: 0, cost: 0, jobs: new Set(), shifts: 0, late: 0, outside: 0, scheduled: 0 }).get(id)!;
  tsl.forEach((t) => { const e = E(t.employee_id); e.hours += Number(t.total_hours); e.cost += Number(t.estimated_earnings); if (t.job_id) e.jobs.add(t.job_id); });
  attl.forEach((a) => { const e = E(a.employee_id); e.shifts++; if (a.flags?.includes('late_clock_in')) e.late++; if (a.clock_in_location === 'outside_geofence') e.outside++; });
  jobs.filter((j) => j.status !== 'cancelled').forEach((j) => j.job_assignments.forEach((a: any) => { E(a.employee_id).scheduled += (new Date(j.scheduled_end).getTime() - new Date(j.scheduled_start).getTime()) / 36e5; }));
  const name = new Map((people ?? []).map((p: any) => [p.id, p.full_name]));
  const empRows = [...emp.entries()].filter(([id]) => name.has(id)).sort((a, b) => b[1].hours - a[1].hours);
  const maxH = Math.max(1, ...empRows.map(([, e]) => e.hours));

  // labor cost per job → profitability
  const costByJob = new Map<string, number>();
  tsl.forEach((t) => t.job_id && costByJob.set(t.job_id, (costByJob.get(t.job_id) ?? 0) + Number(t.estimated_earnings)));
  const group = (key: 'client' | 'property') => {
    const m = new Map<string, { name: string; revenue: number; cost: number; jobs: number }>();
    completed.forEach((j) => {
      const k = key === 'client' ? j.client_id : j.property_id;
      const v = m.get(k) ?? { name: j[key]?.name ?? '—', revenue: 0, cost: 0, jobs: 0 };
      v.revenue += Number(j.price ?? 0); v.cost += costByJob.get(j.id) ?? 0; v.jobs++;
      m.set(k, v);
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  };
  const byClient = group('client');
  const byProperty = group('property');
  const maxRev = Math.max(1, ...byClient.map((c) => c.revenue));
  const jobProfit = completed.map((j) => ({ ...j, cost: costByJob.get(j.id) ?? 0, margin: Number(j.price ?? 0) - (costByJob.get(j.id) ?? 0) })).sort((a, b) => a.margin - b.margin);
  const teams = [...new Set((people ?? []).map((p: any) => p.employee_profiles?.team).filter(Boolean))] as string[];
  const qs = new URLSearchParams(Object.entries({ from, to, employee: sp.employee, client: sp.client }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader title="Reports & analytics" subtitle={`${fmtPlainDate(from)} – ${fmtPlainDate(to)} · revenue counts completed jobs; labor uses timesheet estimates`}
        actions={<a className={buttonClass('secondary')} href={`/api/export/timesheets?format=xlsx&${qs}`}><Download className="size-4" />Labor detail (Excel)</a>} />
      <Card className="mb-6 p-4">
        <form className="flex flex-wrap items-end gap-2" action="/admin/reports">
          <label className="text-xs text-stone-500">From<Input type="date" name="from" defaultValue={from} className="w-40" /></label>
          <label className="text-xs text-stone-500">To<Input type="date" name="to" defaultValue={to} className="w-40" /></label>
          <Select name="employee" defaultValue={sp.employee ?? ''} className="w-44"><option value="">All employees</option>{(people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select>
          {teams.length > 0 && <Select name="team" defaultValue={sp.team ?? ''} className="w-36"><option value="">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</Select>}
          <Select name="client" defaultValue={sp.client ?? ''} className="w-44"><option value="">All clients</option>{(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="property" defaultValue={sp.property ?? ''} className="w-44"><option value="">All properties</option>{(props ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ''} className="w-40"><option value="">All statuses</option>{Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <button className={buttonClass('secondary')}>Apply</button>
          <Link href="/admin/reports" className="text-sm text-stone-500 hover:underline">Reset</Link>
        </form>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Jobs completed" value={completed.length} hint={`${jobs.length} scheduled`} />
        <Stat label="Revenue" value={fmtMoney(revenue, cur)} />
        <Stat label="Labor hours" value={laborHours.toFixed(1)} />
        <Stat label="Labor cost (est.)" value={fmtMoney(laborCost, cur)} />
        <Stat label="Gross margin" value={revenue ? `${(((revenue - laborCost) / revenue) * 100).toFixed(0)}%` : '—'} hint={fmtMoney(revenue - laborCost, cur)} tone={revenue - laborCost >= 0 ? 'good' : 'warn'} />
        <Stat label="Avg job duration" value={avgDur ? `${avgDur.toFixed(1)} h` : '—'} hint="worked, all cleaners" />
        <Stat label="On-time clock-ins" value={onTime == null ? '—' : `${Math.round(onTime * 100)}%`} hint={inFence == null ? undefined : `${Math.round(inFence * 100)}% inside geofence`} />
        <Stat label="Schedule utilization" value={scheduledHours ? `${Math.round((laborHours / scheduledHours) * 100)}%` : '—'} hint="worked ÷ scheduled hours" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader title="Employee productivity & attendance" />
          {empRows.length === 0 ? <Empty title="No labor in this range" /> : (
            <Table>
              <thead><tr><Th>Employee</Th><Th>Labor hours</Th><Th>Scheduled h</Th><Th>Jobs</Th><Th>Est. pay</Th><Th>Shifts</Th><Th>Late</Th><Th>Outside geofence</Th></tr></thead>
              <tbody>
                {empRows.map(([id, e]) => (
                  <tr key={id}>
                    <Td className="font-medium text-ink"><Link className="hover:text-sage-700" href={`/admin/employees/${id}`}>{name.get(id)}</Link></Td>
                    <Td className="min-w-40"><span className="tabular-nums">{e.hours.toFixed(1)}</span><Meter value={e.hours} max={maxH} className="mt-1" /></Td>
                    <Td className="tabular-nums">{e.scheduled.toFixed(1)}</Td>
                    <Td>{e.jobs.size}</Td>
                    <Td className="tabular-nums">{fmtMoney(e.cost, cur)}</Td>
                    <Td>{e.shifts}</Td>
                    <Td className={e.late ? 'text-amber-700' : ''}>{e.late}</Td>
                    <Td className={e.outside ? 'text-red-700' : ''}>{e.outside}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Revenue by client" />
          {byClient.length === 0 ? <Empty title="No completed jobs" /> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Jobs</Th><Th>Revenue</Th><Th>Labor</Th><Th>Margin</Th></tr></thead>
              <tbody>{byClient.map((c) => (
                <tr key={c.name}><Td className="font-medium">{c.name}</Td><Td>{c.jobs}</Td><Td className="min-w-36 tabular-nums">{fmtMoney(c.revenue, cur)}<Meter value={c.revenue} max={maxRev} className="mt-1" /></Td><Td className="tabular-nums">{fmtMoney(c.cost, cur)}</Td><Td className="tabular-nums">{fmtMoney(c.revenue - c.cost, cur)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Revenue by property" />
          {byProperty.length === 0 ? <Empty title="No completed jobs" /> : (
            <Table>
              <thead><tr><Th>Property</Th><Th>Jobs</Th><Th>Revenue</Th><Th>Avg / visit</Th><Th>Margin</Th></tr></thead>
              <tbody>{byProperty.map((c) => (
                <tr key={c.name}><Td className="font-medium">{c.name}</Td><Td>{c.jobs}</Td><Td className="tabular-nums">{fmtMoney(c.revenue, cur)}</Td><Td className="tabular-nums">{fmtMoney(c.revenue / c.jobs, cur)}</Td><Td className="tabular-nums">{fmtMoney(c.revenue - c.cost, cur)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Job profitability" subtitle="Lowest margin first — price minus estimated labor" />
          {jobProfit.length === 0 ? <Empty title="No completed jobs" /> : (
            <Table>
              <thead><tr><Th>Job</Th><Th>Price</Th><Th>Labor</Th><Th>Margin</Th></tr></thead>
              <tbody>{jobProfit.slice(0, 15).map((j) => (
                <tr key={j.id}><Td><Link className="hover:text-sage-700" href={`/admin/jobs/${j.id}`}>{j.title}</Link></Td><Td className="tabular-nums">{fmtMoney(j.price ?? 0, cur)}</Td><Td className="tabular-nums">{fmtMoney(j.cost, cur)}</Td>
                  <Td className={`tabular-nums font-medium ${j.margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtMoney(j.margin, cur)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Payroll expenses" subtitle="Calculated pay periods overlapping this range" />
          {(payroll ?? []).length === 0 ? <Empty title="No payroll runs in range" /> : (
            <Table>
              <thead><tr><Th>Period</Th><Th>Status</Th><Th>Est. gross</Th></tr></thead>
              <tbody>{(payroll as any[]).map((p) => (
                <tr key={p.id}><Td><Link className="hover:text-sage-700" href={`/admin/payroll/${p.id}`}>{fmtPlainDate(p.start_date, { year: undefined })} – {fmtPlainDate(p.end_date)}</Link></Td><Td>{titleCase(p.status)}</Td>
                  <Td className="tabular-nums">{fmtMoney((p.payroll_records ?? []).reduce((a: number, x: any) => a + Number(x.gross_pay), 0), cur)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
