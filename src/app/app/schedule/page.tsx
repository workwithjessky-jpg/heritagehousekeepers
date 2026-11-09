import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { JOB_SELECT, rangeUtc } from '@/lib/queries';
import { todayInTz, addDays, fmtPlainDate } from '@/lib/format';
import { Card, Empty } from '@/components/ui';
import { CalendarNav, MonthGrid, WeekGrid, rangeForView, viewLabel, byDate, type View, type CalJob } from '@/components/calendar';
import { JobList } from '@/components/cleaner-job-list';

export const metadata = { title: 'My schedule' };

export default async function CleanerSchedule({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  await requireRole(['cleaner']);
  const sp = await searchParams;
  const { timezone: tz } = await getSettings();
  const today = todayInTz(tz);
  const view = (['day', 'week', 'month', 'list'].includes(sp.view ?? '') ? sp.view : 'list') as View;
  const date = sp.date || today;
  const { from, to } = rangeForView(view, date);
  const r = rangeUtc(from, to, tz);
  const supabase = await createClient();
  const { data } = await supabase.from('cleaning_jobs').select(JOB_SELECT).gte('scheduled_start', r.from).lt('scheduled_start', r.to).order('scheduled_start');
  const jobs = (data ?? []) as unknown as CalJob[];
  const hrefFor = (j: CalJob) => `/app/jobs/${j.id}`;
  const grouped = byDate(jobs, tz);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">My schedule</h1>
      <CalendarNav view={view} date={date} base="/app/schedule" query={{ view, date: sp.date }} label={viewLabel(view, date)} />
      {view === 'week' && <WeekGrid jobs={jobs} from={from} tz={tz} today={today} hrefFor={hrefFor} />}
      {view === 'month' && <MonthGrid jobs={jobs} from={from} month={date} tz={tz} today={today} hrefFor={hrefFor} dayHref={(d) => `/app/schedule?view=day&date=${d}`} />}
      {(view === 'day' || view === 'list') && (
        jobs.length === 0 ? <Card><Empty title="No jobs in this period" /></Card> : (
          <div className="space-y-4">
            {[...grouped.entries()].map(([d, list]) => (
              <Card key={d}>
                <div className="border-b border-stone-100 px-5 py-2.5 text-sm font-semibold text-stone-600">{d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : fmtPlainDate(d, { weekday: 'long', year: undefined })}</div>
                <JobList jobs={list} tz={tz} />
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
