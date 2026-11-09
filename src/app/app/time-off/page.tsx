import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtPlainDate, titleCase, todayInTz } from '@/lib/format';
import { Card, CardHeader, CardBody, Field, Input, Select, Textarea, StatusBadge, REQ_STATUS, Empty } from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import { AvailabilityForm } from '@/components/availability-form';
import { removeAvailability } from '@/app/admin/_actions/people';
import { requestTimeOff, cancelTimeOff } from '../actions';

export const metadata = { title: 'Time off' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function CleanerTimeOff() {
  const me = await requireRole(['cleaner']);
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  const [{ data: reqs }, { data: av }] = await Promise.all([
    supabase.from('time_off_requests').select('*').order('start_date', { ascending: false }).limit(30),
    supabase.from('employee_availability').select('*').order('weekday').order('start_time'),
  ]);
  const today = todayInTz(tz);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Time off & availability</h1>
      <Card>
        <CardHeader title="Request time off" />
        <CardBody>
          <ActionForm action={requestTimeOff} resetOnSuccess className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day off"><Input type="date" name="start_date" min={today} required className="h-12 text-base" /></Field>
              <Field label="Last day off"><Input type="date" name="end_date" min={today} required className="h-12 text-base" /></Field>
            </div>
            <Field label="Type">
              <Select name="kind" defaultValue="personal" className="h-12 text-base">{['vacation', 'sick', 'personal', 'unpaid', 'other'].map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</Select>
            </Field>
            <Field label="Reason (optional)"><Textarea name="reason" rows={2} className="text-base" /></Field>
            <SubmitButton size="lg" className="w-full">Send request</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="My requests" />
        {(reqs ?? []).length === 0 ? <Empty title="No requests yet" /> : (
          <ul className="divide-y divide-stone-100">
            {(reqs as any[]).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <div>
                  <div className="font-medium">{fmtPlainDate(r.start_date, { year: undefined })} → {fmtPlainDate(r.end_date)}</div>
                  <div className="text-sm text-stone-500">{titleCase(r.kind)}{r.review_notes && ` · “${r.review_notes}”`}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge map={REQ_STATUS} value={r.status} />
                  {r.status === 'pending' && <ActionButton action={cancelTimeOff} fields={{ id: r.id }} variant="ghost" confirm="Cancel this request?">Cancel</ActionButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="My weekly availability" subtitle="When can you usually work? The office uses this when scheduling." />
        <CardBody className="space-y-3">
          <ul className="space-y-1 text-[15px]">
            {(av ?? []).map((a: any) => (
              <li key={a.id} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2">
                <span><b>{DAYS[a.weekday]}</b> {a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}</span>
                <ActionButton action={removeAvailability} fields={{ id: a.id }} variant="ghost">Remove</ActionButton>
              </li>
            ))}
            {!(av ?? []).length && <li className="text-sm text-stone-500">Not set — the office assumes you&apos;re flexible.</li>}
          </ul>
          <AvailabilityForm userId={me.id} />
        </CardBody>
      </Card>
    </div>
  );
}
