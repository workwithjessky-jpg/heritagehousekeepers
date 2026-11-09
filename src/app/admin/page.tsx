import Link from 'next/link';
import {
  Users, Building2, Home, CalendarCheck, Timer, CircleCheck, UserX, TriangleAlert, Clock, Wallet, Plus, MapPin,
} from 'lucide-react';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayRange, weekRange, currentPeriod, JOB_SELECT } from '@/lib/queries';
import { fmtMoney, fmtTime, fmtDateTime, fmtPlainDate } from '@/lib/format';
import { Card, CardHeader, Stat, PageHeader, LinkButton, Badge, JOB_STATUS, LOC_STATUS, StatusBadge, Empty, DemoTag, Flags } from '@/components/ui';

export const metadata = { title: 'Dashboard' };

export default async function AdminDashboard() {
  const me = await requireRole(STAFF);
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const t = todayRange(tz);
  const w = weekRange(tz);
  const period = await currentPeriod(tz);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const [cleaners, clients, properties, todays, upcomingOpen, live, exceptions, weekTs, periodTs, pendingTs, pendingTor, openIssues] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role_key', 'cleaner').eq('is_active', true),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('cleaning_jobs').select(JOB_SELECT).gte('scheduled_start', t.from).lt('scheduled_start', t.to).order('scheduled_start'),
    supabase.from('cleaning_jobs').select('id,title,scheduled_start,status,job_assignments(employee_id)')
      .in('status', ['scheduled', 'needs_attention']).gte('scheduled_start', new Date().toISOString()).lt('scheduled_start', in14).order('scheduled_start').limit(50),
    supabase.from('attendance_records').select('id,clock_in_at,clock_in_location,clock_in_distance_m,flags,user:users!attendance_records_employee_id_fkey(full_name),job:cleaning_jobs(id,title,property:properties(name))').is('clock_out_at', null).order('clock_in_at'),
    supabase.from('attendance_records').select('id,clock_in_at,flags,status,clock_in_location,user:users!attendance_records_employee_id_fkey(full_name),job:cleaning_jobs(title)')
      .gte('clock_in_at', weekAgo).or('status.eq.exception_pending,clock_in_location.eq.outside_geofence,clock_in_location.eq.unavailable').order('clock_in_at', { ascending: false }).limit(8),
    supabase.from('timesheets').select('total_hours').gte('work_date', w.start).lt('work_date', w.end),
    period ? supabase.from('timesheets').select('estimated_earnings,status').gte('work_date', period.start_date).lte('work_date', period.end_date)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']),
    supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('job_issues').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
  ]);

  const jobs = (todays.data ?? []) as any[];
  const unassigned = (upcomingOpen.data ?? []).filter((j: any) => !j.job_assignments?.length || j.status === 'needs_attention');
  const laborHours = (weekTs.data ?? []).reduce((a: number, r: any) => a + Number(r.total_hours), 0);
  const estPayroll = (periodTs.data ?? []).filter((r: any) => r.status !== 'rejected').reduce((a: number, r: any) => a + Number(r.estimated_earnings), 0);
  const inProgress = jobs.filter((j) => j.status === 'in_progress').length;
  const completed = jobs.filter((j) => j.status === 'completed').length;

  return (
    <>
      <PageHeader
        title={`Good ${greeting(tz)}, ${me.full_name.split(' ')[0]}`}
        subtitle={`${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} · live operations overview`}
        actions={<LinkButton href="/admin/jobs/new"><Plus className="size-4" /> New job</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Active cleaners" value={cleaners.count ?? 0} icon={<Users className="size-4" />} href="/admin/employees" />
        <Stat label="Active clients" value={clients.count ?? 0} icon={<Building2 className="size-4" />} href="/admin/clients" />
        <Stat label="Properties" value={properties.count ?? 0} icon={<Home className="size-4" />} href="/admin/clients" />
        <Stat label="Today's jobs" value={jobs.length} hint={`${jobs.filter((j) => j.status === 'cancelled').length} cancelled`} icon={<CalendarCheck className="size-4" />} href="/admin/schedule?view=day" />
        <Stat label="In progress" value={inProgress} icon={<Timer className="size-4" />} href="/admin/attendance" />
        <Stat label="Completed today" value={completed} icon={<CircleCheck className="size-4" />} tone="good" />
        <Stat label="Unassigned (14 days)" value={unassigned.length} icon={<UserX className="size-4" />} tone={unassigned.length ? 'warn' : 'default'} href="/admin/schedule?view=list&filter=unassigned" />
        <Stat label="Attendance exceptions (7d)" value={(exceptions.data ?? []).length} icon={<TriangleAlert className="size-4" />} tone={(exceptions.data ?? []).length ? 'warn' : 'default'} href="/admin/attendance" />
        <Stat label="Labor hours this week" value={laborHours.toFixed(1)} icon={<Clock className="size-4" />} href="/admin/timesheets" />
        {isSupervisor(me.role)
          ? <Stat label="Est. payroll this period" value={fmtMoney(estPayroll, s.currency)} hint={period ? `${fmtPlainDate(period.start_date, { year: undefined })} – ${fmtPlainDate(period.end_date, { year: undefined })} · gross` : undefined} icon={<Wallet className="size-4" />} href="/admin/payroll" />
          : <Stat label="Timesheets to review" value={pendingTs.count ?? 0} icon={<Wallet className="size-4" />} href="/admin/timesheets" />}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Today's schedule" subtitle={`${jobs.length} job${jobs.length === 1 ? '' : 's'}`} action={<LinkButton href="/admin/schedule?view=day" variant="secondary" size="sm">Open calendar</LinkButton>} />
          {jobs.length === 0 ? <Empty title="No jobs scheduled today" icon={<CalendarCheck className="size-5" />} /> : (
            <ul className="divide-y divide-stone-100">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/admin/jobs/${j.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-stone-50">
                    <div className="w-28 shrink-0 text-sm tabular-nums text-stone-600">{fmtTime(j.scheduled_start, tz)} – {fmtTime(j.scheduled_end, tz)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-medium text-ink">{j.title} <DemoTag show={j.is_demo} /></div>
                      <div className="truncate text-xs text-stone-500">{j.property?.address}</div>
                    </div>
                    <div className="text-sm text-stone-600">{j.job_assignments?.length ? j.job_assignments.map((a: any) => a.user?.full_name).join(', ') : <span className="text-amber-700">Unassigned</span>}</div>
                    <StatusBadge map={JOB_STATUS} value={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="On the clock now" subtitle="Live from GPS clock-ins" />
            {(live.data ?? []).length === 0 ? <Empty title="Nobody is clocked in" icon={<MapPin className="size-5" />} /> : (
              <ul className="divide-y divide-stone-100">
                {(live.data as any[]).map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{a.user?.full_name}</span>
                      <StatusBadge map={LOC_STATUS} value={a.clock_in_location} />
                    </div>
                    <div className="text-xs text-stone-500">{a.job?.property?.name ?? a.job?.title} · since {fmtTime(a.clock_in_at, tz)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Needs your attention" />
            <ul className="divide-y divide-stone-100 text-sm">
              <AttentionRow href="/admin/schedule?view=list&filter=unassigned" label="Unassigned / needs attention jobs" n={unassigned.length} />
              <AttentionRow href="/admin/timesheets?status=submitted" label="Timesheets awaiting review" n={pendingTs.count ?? 0} />
              <AttentionRow href="/admin/time-off" label="Time-off requests" n={pendingTor.count ?? 0} />
              <AttentionRow href="/admin/quality" label="Open property issues" n={openIssues.count ?? 0} />
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent attendance exceptions" subtitle="Outside geofence, missing GPS, or pending review — last 7 days" action={<LinkButton href="/admin/attendance" variant="secondary" size="sm">Review</LinkButton>} />
        {(exceptions.data ?? []).length === 0 ? <Empty title="No exceptions this week" /> : (
          <ul className="divide-y divide-stone-100">
            {(exceptions.data as any[]).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="w-40 text-stone-500">{fmtDateTime(a.clock_in_at, tz)}</span>
                <span className="font-medium text-ink">{a.user?.full_name}</span>
                <span className="text-stone-500">{a.job?.title}</span>
                <Flags flags={a.flags} />
                {a.status === 'exception_pending' && <Badge tone="amber">Pending review</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AttentionRow({ href, label, n }: { href: string; label: string; n: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between px-5 py-3 hover:bg-stone-50">
        <span className="text-stone-700">{label}</span>
        <Badge tone={n ? 'amber' : 'gray'}>{n}</Badge>
      </Link>
    </li>
  );
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}


