import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, fmtTime, startOfWeek, utcToZonedInput, weekday, fmtPlainDate } from '@/lib/format';
import { JOB_STATUS, cx, buttonClass } from './ui';

export type CalJob = {
  id: string; title: string; status: string; scheduled_start: string; scheduled_end: string;
  property?: { name?: string; address?: string } | null;
  job_assignments?: { employee_id: string; is_team_lead: boolean; user?: { full_name?: string } | null }[];
  is_demo?: boolean;
};

export type View = 'day' | 'week' | 'month' | 'list';

export function rangeForView(view: View, date: string) {
  if (view === 'day') return { from: date, to: addDays(date, 1) };
  if (view === 'week') { const m = startOfWeek(date); return { from: m, to: addDays(m, 7) }; }
  if (view === 'month') {
    const first = date.slice(0, 8) + '01';
    const gridStart = startOfWeek(first);
    return { from: gridStart, to: addDays(gridStart, 42) };
  }
  return { from: date, to: addDays(date, 30) };
}

export function shiftDate(view: View, date: string, dir: 1 | -1) {
  if (view === 'day') return addDays(date, dir);
  if (view === 'week') return addDays(date, 7 * dir);
  if (view === 'list') return addDays(date, 30 * dir);
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

export function CalendarNav({ view, date, base, query, label }: { view: View; date: string; base: string; query: Record<string, string | undefined>; label: string }) {
  const q = (o: Record<string, string>) => {
    const p = new URLSearchParams();
    Object.entries({ ...query, ...o }).forEach(([k, v]) => v && p.set(k, v));
    return `${base}?${p.toString()}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Link aria-label="Previous" className={buttonClass('secondary', 'sm')} href={q({ view, date: shiftDate(view, date, -1) })}><ChevronLeft className="size-4" /></Link>
        <Link className={buttonClass('secondary', 'sm')} href={q({ view, date: '' })}>Today</Link>
        <Link aria-label="Next" className={buttonClass('secondary', 'sm')} href={q({ view, date: shiftDate(view, date, 1) })}><ChevronRight className="size-4" /></Link>
      </div>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <div className="ml-auto flex gap-1 rounded-xl bg-stone-100 p-1">
        {(['day', 'week', 'month', 'list'] as View[]).map((v) => (
          <Link key={v} href={q({ view: v, date })} className={cx('rounded-lg px-3 py-1 text-[13px] font-medium capitalize', v === view ? 'bg-white text-ink shadow-sm' : 'text-stone-600')}>{v}</Link>
        ))}
      </div>
    </div>
  );
}

export function viewLabel(view: View, date: string) {
  if (view === 'day') return fmtPlainDate(date, { weekday: 'long' });
  if (view === 'week') { const m = startOfWeek(date); return `${fmtPlainDate(m, { year: undefined })} – ${fmtPlainDate(addDays(m, 6))}`; }
  if (view === 'month') return fmtPlainDate(date, { day: undefined, month: 'long' });
  return `Next 30 days from ${fmtPlainDate(date)}`;
}

export function JobChip({ job, tz, href, compact = false }: { job: CalJob; tz: string; href: string; compact?: boolean }) {
  const s = JOB_STATUS[job.status] ?? JOB_STATUS.scheduled;
  const names = job.job_assignments?.map((a) => a.user?.full_name?.split(' ')[0]).filter(Boolean).join(', ');
  return (
    <Link href={href} className={cx('block rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left shadow-[0_1px_0_rgba(0,0,0,0.02)] hover:border-sage-300 hover:bg-sage-50/40', job.status === 'cancelled' && 'opacity-60 line-through')}>
      <div className="flex items-center gap-1.5">
        <span className={cx('size-2 shrink-0 rounded-full', s.dot)} title={s.label} />
        <span className="truncate text-[12px] font-medium text-ink">{fmtTime(job.scheduled_start, tz)} {job.title}</span>
      </div>
      {!compact && (
        <div className="mt-0.5 truncate pl-3.5 text-[11px] text-stone-500">
          {names || <span className="text-amber-700">Unassigned</span>}
        </div>
      )}
    </Link>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {Object.entries(JOB_STATUS).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5"><span className={cx('size-2 rounded-full', v.dot)} />{v.label}</span>
      ))}
    </div>
  );
}

/** Groups jobs by local date (YYYY-MM-DD) in tz */
export function byDate(jobs: CalJob[], tz: string) {
  const m = new Map<string, CalJob[]>();
  for (const j of jobs) {
    const d = utcToZonedInput(j.scheduled_start, tz).slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), j]);
  }
  return m;
}

export function WeekGrid({ jobs, from, tz, today, hrefFor }: { jobs: CalJob[]; from: string; tz: string; today: string; hrefFor: (j: CalJob) => string }) {
  const g = byDate(jobs, tz);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => (
        <div key={d} className={cx('min-h-32 rounded-xl border p-2', d === today ? 'border-sage-300 bg-sage-50/50' : 'border-stone-200 bg-white')}>
          <div className="mb-2 text-xs font-semibold text-stone-500">{fmtPlainDate(d, { weekday: 'short', year: undefined })}</div>
          <div className="space-y-1.5">
            {(g.get(d) ?? []).map((j) => <JobChip key={j.id} job={j} tz={tz} href={hrefFor(j)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MonthGrid({ jobs, from, month, tz, today, hrefFor, dayHref }: { jobs: CalJob[]; from: string; month: string; tz: string; today: string; hrefFor: (j: CalJob) => string; dayHref: (d: string) => string }) {
  const g = byDate(jobs, tz);
  return (
    <div>
      <div className="mb-1 hidden grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-stone-400 sm:grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((d) => {
          const list = g.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          if (!inMonth && !list.length) return <div key={d} className="hidden min-h-24 rounded-lg bg-stone-50/50 sm:block" />;
          return (
            <div key={d} className={cx('min-h-24 rounded-lg border p-1.5', d === today ? 'border-sage-400 bg-sage-50/60' : 'border-stone-200 bg-white', !inMonth && 'opacity-50')}>
              <Link href={dayHref(d)} className="mb-1 block text-xs font-semibold text-stone-500 hover:text-sage-700">
                <span className="sm:hidden">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(d)]} </span>{Number(d.slice(8))}
              </Link>
              <div className="space-y-1">
                {list.slice(0, 3).map((j) => <JobChip key={j.id} job={j} tz={tz} href={hrefFor(j)} compact />)}
                {list.length > 3 && <Link href={dayHref(d)} className="block px-1 text-[11px] font-medium text-sage-700">+{list.length - 3} more</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
