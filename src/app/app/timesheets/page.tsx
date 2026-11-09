import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { currentPeriod } from '@/lib/queries';
import { fmtTime, fmtMoney, fmtPlainDate, todayInTz, fmtDateTime, addDays } from '@/lib/format';
import { Card, CardHeader, CardBody, StatusBadge, TS_STATUS, REQ_STATUS, Flags, Empty, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { submitTimesheets, requestCorrection } from '../actions';

export const metadata = { title: 'My hours' };

export default async function CleanerTimesheets({ searchParams }: { searchParams: Promise<{ fix?: string }> }) {
  await requireRole(['cleaner']);
  const { fix } = await searchParams;
  const s = await getSettings();
  const tz = s.timezone;
  const supabase = await createClient();
  const period = await currentPeriod(tz);
  const since = addDays(period?.start_date ?? todayInTz(tz), -42);
  const [{ data: ts }, { data: reqs }, { data: recentJobs }] = await Promise.all([
    supabase.from('timesheets').select('*, job:cleaning_jobs(title,property:properties(name))').gte('work_date', since).order('work_date', { ascending: false }).order('clock_in_at', { ascending: false }),
    supabase.from('timesheet_adjustments').select('*, job:cleaning_jobs(title)').neq('kind', 'manager_edit').order('created_at', { ascending: false }).limit(10),
    supabase.from('cleaning_jobs').select('id,title,scheduled_start').lt('scheduled_start', new Date().toISOString()).gte('scheduled_start', new Date(Date.now() - 14 * 864e5).toISOString()).order('scheduled_start', { ascending: false }),
  ]);
  const list = (ts ?? []) as any[];
  const drafts = list.filter((t) => ['draft', 'rejected'].includes(t.status));
  const fixing = fix ? list.find((t) => t.id === fix) : null;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">My hours</h1>
      {period && <p className="-mt-2 text-sm text-stone-500">Pay period {fmtPlainDate(period.start_date, { year: undefined })} – {fmtPlainDate(period.end_date, { year: undefined })}</p>}

      {drafts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardBody>
            <p className="text-[15px] font-medium text-ink">{drafts.length} shift{drafts.length > 1 ? 's' : ''} ready to submit ({drafts.reduce((a, t) => a + Number(t.total_hours), 0).toFixed(2)} h)</p>
            <p className="text-sm text-stone-600">Check the times below, then send them to your manager.</p>
            <ActionForm action={submitTimesheets} className="mt-3">
              {drafts.map((t) => <input key={t.id} type="hidden" name="ids" value={t.id} />)}
              <SubmitButton size="lg" className="w-full">Submit for approval</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {list.length === 0 ? <Card><Empty title="No shifts yet">Your hours appear here automatically after you clock out.</Empty></Card> : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {list.map((t) => (
              <li key={t.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{fmtPlainDate(t.work_date, { weekday: 'short', year: undefined })} · {t.job?.property?.name ?? t.job?.title ?? 'Manual entry'}</div>
                    <div className="text-sm text-stone-600 tabular-nums">{fmtTime(t.clock_in_at, tz)} – {fmtTime(t.clock_out_at, tz)}{t.break_minutes ? ` · ${t.break_minutes}m break` : ''}</div>
                    <div className="text-sm text-stone-500">{Number(t.total_hours).toFixed(2)} h × {fmtMoney(t.pay_rate, s.currency)} = <b className="text-ink">{fmtMoney(t.estimated_earnings, s.currency)}</b></div>
                  </div>
                  <StatusBadge map={TS_STATUS} value={t.status} />
                </div>
                {t.flags?.length > 0 && <div className="mt-1.5"><Flags flags={t.flags} /></div>}
                {t.review_notes && <p className="mt-1 text-sm text-stone-600">Manager: “{t.review_notes}”</p>}
                {!['approved', 'paid'].includes(t.status) && <a href={`/app/timesheets?fix=${t.id}#correction`} className="mt-1 inline-block text-sm font-medium text-sage-700">Times wrong? Request a correction</a>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card id="correction">
        <CardHeader title={fixing ? 'Correct this shift' : 'Forgot to clock in or out?'} subtitle={fixing ? `${fmtPlainDate(fixing.work_date)} · currently ${fmtTime(fixing.clock_in_at, tz)} – ${fmtTime(fixing.clock_out_at, tz)}` : 'Tell your manager the real times. They will approve or adjust it.'} />
        <CardBody>
          <ActionForm action={requestCorrection} resetOnSuccess className="space-y-3">
            {fixing && <input type="hidden" name="timesheet_id" value={fixing.id} />}
            {!fixing && (
              <Field label="Which job?">
                <Select name="job_id" className="h-12 text-base" required defaultValue="">
                  <option value="" disabled>Choose a recent job</option>
                  {(recentJobs ?? []).map((j: any) => <option key={j.id} value={j.id}>{fmtDateTime(j.scheduled_start, tz)} · {j.title}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Date"><Input type="date" name="date" required className="h-12 text-base" defaultValue={fixing?.work_date ?? todayInTz(tz)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Started"><Input type="time" name="clock_in" required className="h-12 text-base" /></Field>
              <Field label="Finished"><Input type="time" name="clock_out" required className="h-12 text-base" /></Field>
            </div>
            <Field label="Break (minutes)"><Input type="number" name="break_minutes" min={0} defaultValue={0} className="h-12 text-base" /></Field>
            <Field label="What happened?"><Textarea name="reason" required rows={2} className="text-base" placeholder="e.g. Phone battery died so I couldn't clock out" /></Field>
            <SubmitButton size="lg" className="w-full">Send request</SubmitButton>
          </ActionForm>
          {(reqs ?? []).length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold uppercase text-stone-400">Your requests</div>
              {(reqs as any[]).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm">
                  <span>{fmtDateTime(r.new_values.clock_in_at, tz)} – {fmtTime(r.new_values.clock_out_at, tz)}{r.review_notes && <span className="block text-xs text-stone-500">{r.review_notes}</span>}</span>
                  <StatusBadge map={REQ_STATUS} value={r.status} />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
