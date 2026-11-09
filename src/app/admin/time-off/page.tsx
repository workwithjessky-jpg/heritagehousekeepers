import Link from 'next/link';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtPlainDate, fmtDateTime, titleCase, todayInTz } from '@/lib/format';
import { Card, CardHeader, PageHeader, Table, Th, Td, StatusBadge, REQ_STATUS, Empty, Input } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { reviewTimeOff } from '../_actions/people';

export const metadata = { title: 'Time Off' };

export default async function TimeOffPage() {
  const me = await requireRole(STAFF);
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  const { data } = await supabase.from('time_off_requests')
    .select('*, user:users!time_off_requests_employee_id_fkey(id,full_name), reviewer:users!time_off_requests_reviewed_by_fkey(full_name)')
    .order('status').order('start_date', { ascending: false }).limit(200);
  const list = (data ?? []) as any[];
  const pending = list.filter((r) => r.status === 'pending');
  const today = todayInTz(tz);
  const upcoming = list.filter((r) => r.status === 'approved' && r.end_date >= today);
  const canDecide = isSupervisor(me.role);

  return (
    <>
      <PageHeader title="Time off" subtitle="Approving a request flags any overlapping jobs as “Needs Attention” so dispatch can reassign them." />
      <div className="grid gap-6">
        <Card>
          <CardHeader title={`Pending requests (${pending.length})`} />
          {pending.length === 0 ? <Empty title="Nothing waiting for a decision" /> : (
            <Table>
              <thead><tr><Th>Employee</Th><Th>Dates</Th><Th>Type</Th><Th>Reason</Th><Th>Requested</Th><Th>Decision</Th></tr></thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium text-ink"><Link className="hover:text-sage-700" href={`/admin/employees/${r.user?.id}`}>{r.user?.full_name}</Link></Td>
                    <Td className="whitespace-nowrap">{fmtPlainDate(r.start_date)} → {fmtPlainDate(r.end_date)}<div><Link className="text-xs text-sage-700 underline" href={`/admin/schedule?view=week&date=${r.start_date}&employee=${r.user?.id}`}>See their jobs</Link></div></Td>
                    <Td>{titleCase(r.kind)}</Td>
                    <Td className="max-w-64">{r.reason ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(r.created_at, tz)}</Td>
                    <Td>
                      {canDecide ? (
                        <ActionForm action={reviewTimeOff} className="flex min-w-64 flex-col gap-1">
                          <input type="hidden" name="id" value={r.id} />
                          <Input name="notes" placeholder="Note to employee (optional)" className="h-8 text-xs" />
                          <div className="flex gap-1">
                            <SubmitButton name="decision" value="approve" size="sm" variant="success">Approve</SubmitButton>
                            <SubmitButton name="decision" value="reject" size="sm" variant="danger">Reject</SubmitButton>
                          </div>
                        </ActionForm>
                      ) : <span className="text-xs text-stone-500">Supervisor decision</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming approved time off" />
          {upcoming.length === 0 ? <Empty title="No one is scheduled to be away" /> : (
            <ul className="divide-y divide-stone-100 text-sm">
              {upcoming.map((r) => <li key={r.id} className="flex justify-between px-5 py-2.5"><span className="font-medium">{r.user?.full_name}</span><span>{fmtPlainDate(r.start_date)} → {fmtPlainDate(r.end_date)} · {titleCase(r.kind)}</span></li>)}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="History" />
          <Table>
            <thead><tr><Th>Employee</Th><Th>Dates</Th><Th>Type</Th><Th>Status</Th><Th>Reviewed by</Th></tr></thead>
            <tbody>
              {list.filter((r) => r.status !== 'pending').map((r) => (
                <tr key={r.id}><Td>{r.user?.full_name}</Td><Td>{fmtPlainDate(r.start_date)} → {fmtPlainDate(r.end_date)}</Td><Td>{titleCase(r.kind)}</Td><Td><StatusBadge map={REQ_STATUS} value={r.status} /></Td><Td>{r.reviewer?.full_name ?? '—'}{r.review_notes && <div className="text-xs text-stone-500">{r.review_notes}</div>}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
