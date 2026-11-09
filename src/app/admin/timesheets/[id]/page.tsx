import { notFound } from 'next/navigation';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { utcToZonedInput, fmtDateTime, fmtTime, fmtPlainDate } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Textarea, StatusBadge, TS_STATUS, Flags, LinkButton } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { editTimesheet } from '../../_actions/pay';

export const metadata = { title: 'Edit timesheet entry' };

export default async function EditTimesheetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(STAFF);
  const { id } = await params;
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  const { data: t } = await supabase.from('timesheets').select('*, user:users!timesheets_employee_id_fkey(full_name), job:cleaning_jobs(title)').eq('id', id).single();
  if (!t) notFound();
  const { data: history } = await supabase.from('timesheet_adjustments').select('*, requester:users!timesheet_adjustments_requested_by_fkey(full_name)').eq('timesheet_id', id).order('created_at', { ascending: false });

  return (
    <>
      <PageHeader title={`Timesheet · ${t.user?.full_name}`} subtitle={`${fmtPlainDate(t.work_date, { weekday: 'long' })} · ${t.job?.title ?? 'Manual entry'}`} actions={<LinkButton href="/admin/timesheets" variant="secondary">Back</LinkButton>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Edit entry" subtitle="Every edit is recorded with your name and reason; approved entries return to Under Review." action={<StatusBadge map={TS_STATUS} value={t.status} />} />
          <CardBody>
            <div className="mb-4"><Flags flags={t.flags} /></div>
            {t.status === 'paid' ? <p className="text-sm text-stone-600">Paid entries are locked.</p> : (
              <ActionForm action={editTimesheet} className="space-y-3">
                <input type="hidden" name="id" value={t.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Clock in (${tz})`}><Input type="datetime-local" name="clock_in" defaultValue={utcToZonedInput(t.clock_in_at, tz)} required /></Field>
                  <Field label="Clock out"><Input type="datetime-local" name="clock_out" defaultValue={utcToZonedInput(t.clock_out_at, tz)} required /></Field>
                </div>
                <Field label="Break (minutes)"><Input type="number" min={0} max={600} name="break_minutes" defaultValue={t.break_minutes} /></Field>
                <Field label="Reason for change (shown to employee)"><Textarea name="reason" required rows={2} placeholder="e.g. Client confirmed team stayed until 3:30pm" /></Field>
                <SubmitButton>Save with audit trail</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change history" />
          <CardBody>
            {(history ?? []).length === 0 ? <p className="text-sm text-stone-500">No changes — this entry came straight from GPS clock-in/out.</p> : (
              <ol className="space-y-3 text-sm">
                {(history as any[]).map((h) => (
                  <li key={h.id} className="rounded-xl bg-stone-50 p-3">
                    <div className="font-medium">{h.requester?.full_name} · {fmtDateTime(h.created_at, tz)}</div>
                    {h.old_values && <div className="text-stone-500 line-through">{fmtTime(h.old_values.clock_in_at, tz)} – {fmtTime(h.old_values.clock_out_at, tz)} ({h.old_values.total_hours ?? '?'} h)</div>}
                    <div>{fmtTime(h.new_values.clock_in_at, tz)} – {fmtTime(h.new_values.clock_out_at, tz)} ({h.new_values.total_hours ?? '?'} h)</div>
                    <div className="text-stone-600">“{h.reason}”</div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
