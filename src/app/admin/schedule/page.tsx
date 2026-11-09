import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { JOB_SELECT, rangeUtc } from '@/lib/queries';
import { todayInTz, fmtTime, fmtDateTime } from '@/lib/format';
import { Card, PageHeader, LinkButton, Select, Table, Th, Td, StatusBadge, JOB_STATUS, Empty, DemoTag, Badge, buttonClass } from '@/components/ui';
import { CalendarNav, MonthGrid, WeekGrid, StatusLegend, rangeForView, viewLabel, JobChip, type View, type CalJob } from '@/components/calendar';

export const metadata = { title: 'Schedule & Dispatch' };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(STAFF);
  const sp = await searchParams;
  const { timezone: tz } = await getSettings();
  const today = todayInTz(tz);
  const view = (['day', 'week', 'month', 'list'].includes(sp.view ?? '') ? sp.view : 'week') as View;
  const date = sp.date || today;
  const { from, to } = rangeForView(view, date);
  const r = rangeUtc(from, to, tz);
  const supabase = await createClient();

  const [jobsRes, staffRes] = await Promise.all([
    (() => {
      let q = supabase.from('cleaning_jobs').select(JOB_SELECT).gte('scheduled_start', r.from).lt('scheduled_start', r.to).order('scheduled_start');
      if (sp.status) q = q.eq('status', sp.status);
      return q;
    })(),
    supabase.from('users').select('id,full_name,employee_profiles(team)').eq('role_key', 'cleaner').eq('is_active', true).order('full_name'),
  ]);

  let jobs = (jobsRes.data ?? []) as unknown as CalJob[];
  const cleaners = (staffRes.data ?? []) as any[];
  const teams = [...new Set(cleaners.map((c) => c.employee_profiles?.team).filter(Boolean))] as string[];
  if (sp.employee) jobs = jobs.filter((j) => j.job_assignments?.some((a) => a.employee_id === sp.employee));
  if (sp.team) {
    const ids = new Set(cleaners.filter((c) => c.employee_profiles?.team === sp.team).map((c) => c.id));
    jobs = jobs.filter((j) => j.job_assignments?.some((a) => ids.has(a.employee_id)));
  }
  if (sp.filter === 'unassigned') jobs = jobs.filter((j) => !j.job_assignments?.length || j.status === 'needs_attention');

  const query = { view, date: sp.date, employee: sp.employee, team: sp.team, status: sp.status, filter: sp.filter };
  const hrefFor = (j: CalJob) => `/admin/jobs/${j.id}`;
  const dayHref = (d: string) => `/admin/schedule?${new URLSearchParams({ ...clean(query), view: 'day', date: d })}`;

  return (
    <>
      <PageHeader title="Schedule & Dispatch" subtitle="Plan, assign and adjust cleaning appointments" actions={<LinkButton href="/admin/jobs/new"><Plus className="size-4" /> New job</LinkButton>} />

      <Card className="mb-4 p-4">
        <CalendarNav view={view} date={date} base="/admin/schedule" query={query} label={viewLabel(view, date)} />
        <form className="mt-3 flex flex-wrap items-end gap-2" action="/admin/schedule">
          <input type="hidden" name="view" value={view} />
          {sp.date && <input type="hidden" name="date" value={sp.date} />}
          <Select name="employee" defaultValue={sp.employee ?? ''} className="w-48">
            <option value="">All cleaners</option>
            {cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </Select>
          {teams.length > 0 && (
            <Select name="team" defaultValue={sp.team ?? ''} className="w-40">
              <option value="">All teams</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
          <Select name="status" defaultValue={sp.status ?? ''} className="w-44">
            <option value="">All statuses</option>
            {Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select name="filter" defaultValue={sp.filter ?? ''} className="w-44">
            <option value="">All jobs</option>
            <option value="unassigned">Unassigned only</option>
          </Select>
          <button className={buttonClass('secondary', 'md')}>Apply</button>
          {(sp.employee || sp.status || sp.filter || sp.team) && <Link href={`/admin/schedule?view=${view}`} className="text-sm text-stone-500 hover:underline">Clear</Link>}
        </form>
        <div className="mt-3"><StatusLegend /></div>
      </Card>

      {view === 'week' && <WeekGrid jobs={jobs} from={from} tz={tz} today={today} hrefFor={hrefFor} />}
      {view === 'month' && <MonthGrid jobs={jobs} from={from} month={date} tz={tz} today={today} hrefFor={hrefFor} dayHref={dayHref} />}
      {view === 'day' && <DayBoard jobs={jobs} cleaners={sp.employee ? cleaners.filter((c) => c.id === sp.employee) : cleaners} tz={tz} />}
      {view === 'list' && (
        <Card>
          {jobs.length === 0 ? <Empty title="No jobs match these filters" /> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Job</Th><Th>Client / property</Th><Th>Cleaners</Th><Th>Status</Th></tr></thead>
              <tbody>
                {jobs.map((j: any) => (
                  <tr key={j.id} className="hover:bg-stone-50">
                    <Td className="whitespace-nowrap">{fmtDateTime(j.scheduled_start, tz)}</Td>
                    <Td><Link href={`/admin/jobs/${j.id}`} className="font-medium text-ink hover:text-sage-700">{j.title}</Link> <DemoTag show={j.is_demo} /></Td>
                    <Td>{j.client?.name}<div className="text-xs text-stone-500">{j.property?.name}</div></Td>
                    <Td>{j.job_assignments?.length ? j.job_assignments.map((a: any) => a.user?.full_name).join(', ') : <Badge tone="amber">Unassigned</Badge>}</Td>
                    <Td><StatusBadge map={JOB_STATUS} value={j.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

function clean(o: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;
}

/** Dispatch board: one lane per cleaner + an unassigned lane, with workload hours. */
function DayBoard({ jobs, cleaners, tz }: { jobs: CalJob[]; cleaners: any[]; tz: string }) {
  const unassigned = jobs.filter((j) => !j.job_assignments?.length);
  const hours = (list: CalJob[]) => list.filter((j) => j.status !== 'cancelled')
    .reduce((a, j) => a + (new Date(j.scheduled_end).getTime() - new Date(j.scheduled_start).getTime()) / 36e5, 0);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card className="border-amber-200 bg-amber-50/30 p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold text-amber-900">Unassigned <Badge tone="amber">{unassigned.length}</Badge></div>
        <div className="space-y-1.5">{unassigned.map((j) => <JobChip key={j.id} job={j} tz={tz} href={`/admin/jobs/${j.id}`} />)}</div>
        {!unassigned.length && <p className="text-xs text-stone-500">Every job has a cleaner.</p>}
      </Card>
      {cleaners.map((c) => {
        const mine = jobs.filter((j) => j.job_assignments?.some((a) => a.employee_id === c.id));
        const h = hours(mine);
        return (
          <Card key={c.id} className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <Link href={`/admin/employees/${c.id}`} className="text-sm font-semibold text-ink hover:text-sage-700">{c.full_name}</Link>
              <span className={`text-xs tabular-nums ${h > 8 ? 'font-semibold text-red-700' : 'text-stone-500'}`}>{h.toFixed(1)} h</span>
            </div>
            <div className="space-y-1.5">
              {mine.map((j) => (
                <Link key={j.id} href={`/admin/jobs/${j.id}`} className="block rounded-lg border border-stone-200 px-2 py-1.5 hover:border-sage-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-stone-500">{fmtTime(j.scheduled_start, tz)}–{fmtTime(j.scheduled_end, tz)}</span>
                    <StatusBadge map={JOB_STATUS} value={j.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[13px] font-medium text-ink">{j.title}</div>
                  <div className="truncate text-[11px] text-stone-500">{j.property?.address}</div>
                </Link>
              ))}
              {!mine.length && <p className="text-xs text-stone-400">Available all day</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
