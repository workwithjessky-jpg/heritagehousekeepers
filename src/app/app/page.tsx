import Link from 'next/link';
import { MapPin, Clock, Megaphone, Timer } from 'lucide-react';
import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayRange, weekRange, currentPeriod, JOB_SELECT } from '@/lib/queries';
import { fmtTime, fmtDateTime, fmtMoney, fmtPlainDate, todayInTz } from '@/lib/format';
import { Card, CardHeader, Empty, Badge, DemoTag } from '@/components/ui';
import { JobList } from '@/components/cleaner-job-list';

export const metadata = { title: 'Today' };

export default async function CleanerHome() {
  const me = await requireRole(['cleaner']);
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const t = todayRange(tz);
  const w = weekRange(tz);
  const period = await currentPeriod(tz);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString();

  // RLS: cleaners only ever receive their own jobs / timesheets / attendance
  const [today, upcoming, open, weekTs, periodTs, ann] = await Promise.all([
    supabase.from('cleaning_jobs').select(JOB_SELECT).gte('scheduled_start', t.from).lt('scheduled_start', t.to).neq('status', 'cancelled').order('scheduled_start'),
    supabase.from('cleaning_jobs').select(JOB_SELECT).gte('scheduled_start', t.to).lt('scheduled_start', in7).neq('status', 'cancelled').order('scheduled_start').limit(10),
    supabase.from('attendance_records').select('id,clock_in_at,job_id,job:cleaning_jobs(title)').is('clock_out_at', null).maybeSingle(),
    supabase.from('timesheets').select('total_hours').gte('work_date', w.start).lt('work_date', w.end),
    period ? supabase.from('timesheets').select('total_hours,estimated_earnings,status').gte('work_date', period.start_date).lte('work_date', period.end_date) : Promise.resolve({ data: [] }),
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(3),
  ]);
  const jobs = (today.data ?? []) as any[];
  const next = jobs.find((j) => new Date(j.scheduled_end) > new Date() && j.status !== 'completed') ?? (upcoming.data as any[] ?? [])[0];
  const weekHours = (weekTs.data ?? []).reduce((a: number, r: any) => a + Number(r.total_hours), 0);
  const pts = (periodTs.data ?? []) as any[];
  const periodHours = pts.reduce((a, r) => a + Number(r.total_hours), 0);
  const periodPay = pts.filter((r) => r.status !== 'rejected').reduce((a, r) => a + Number(r.estimated_earnings), 0);
  const drafts = pts.filter((r) => ['draft', 'rejected'].includes(r.status)).length;
  const awaiting = pts.filter((r) => ['submitted', 'under_review'].includes(r.status)).length;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-stone-500">{fmtPlainDate(todayInTz(tz), { weekday: 'long', year: undefined })}</p>
        <h1 className="font-display text-2xl text-ink">Hello, {me.full_name.split(' ')[0]}</h1>
      </div>

      {open.data && (
        <Link href={`/app/jobs/${open.data.job_id}`} className="flex items-center gap-3 rounded-2xl bg-sage-700 p-4 text-white shadow-md">
          <Timer className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm opacity-80">You&apos;re on the clock since {fmtTime(open.data.clock_in_at, tz)}</div>
            <div className="truncate font-semibold">{(open.data as any).job?.title}</div>
          </div>
          <span className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold">Clock out</span>
        </Link>
      )}

      {!open.data && next && (
        <Link href={`/app/jobs/${next.id}`} className="block rounded-2xl border border-sage-200 bg-white p-4 shadow-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sage-700">Next appointment</div>
          <div className="text-lg font-semibold text-ink">{next.title} <DemoTag show={next.is_demo} /></div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-stone-600"><Clock className="size-4" />{fmtDateTime(next.scheduled_start, tz)} – {fmtTime(next.scheduled_end, tz)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-stone-600"><MapPin className="size-4" />{next.property?.address}</div>
          <div className="mt-3 rounded-xl bg-sage-700 py-3 text-center text-base font-semibold text-white">Open job</div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Hours this week" value={weekHours.toFixed(1)} />
        <MiniStat label="Hours this pay period" value={periodHours.toFixed(1)} />
        <MiniStat label="Est. earnings (gross)" value={fmtMoney(periodPay, s.currency)} href="/app/earnings" />
        <MiniStat label="Timesheets" value={drafts ? `${drafts} to submit` : awaiting ? `${awaiting} pending` : 'All set'} href="/app/timesheets" highlight={drafts > 0} />
      </div>

      <Card>
        <CardHeader title="Today's jobs" subtitle={`${jobs.length} scheduled`} />
        {jobs.length === 0 ? <Empty title="No jobs today">Enjoy your day!</Empty> : <JobList jobs={jobs} tz={tz} />}
      </Card>

      {(upcoming.data ?? []).length > 0 && (
        <Card>
          <CardHeader title="Upcoming shifts" action={<Link className="text-sm text-sage-700" href="/app/schedule">See all</Link>} />
          <JobList jobs={upcoming.data as any[]} tz={tz} showDate />
        </Card>
      )}

      {(ann.data ?? []).length > 0 && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Megaphone className="size-4" />Announcements</span>} />
          <ul className="divide-y divide-stone-100">
            {(ann.data as any[]).map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex items-center gap-2 font-medium text-ink">{a.title}{a.pinned && <Badge tone="sage">Pinned</Badge>}</div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-stone-600">{a.body}</p>
                <p className="mt-1 text-xs text-stone-400">{fmtDateTime(a.published_at, tz)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value, href, highlight }: { label: string; value: string; href?: string; highlight?: boolean }) {
  const inner = (
    <div className={`h-full rounded-2xl border p-3.5 ${highlight ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
