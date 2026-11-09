'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Input, Table, Th, Td, StatusBadge, TS_STATUS, Flags, Badge, cx } from '@/components/ui';
import { reviewTimesheets } from '../_actions/pay';

export type Row = {
  id: string; employee: string; employee_id: string; date: string; job: string | null; job_id: string | null;
  inLabel: string; outLabel: string; break_minutes: number; total_hours: number; pay_rate: number; earnings: string;
  status: string; flags: string[]; is_manual: boolean; notes: string | null; review_notes: string | null; editable: boolean;
};

/** Timesheet table with row selection for bulk approve / reject / under review. */
export function BulkTable({ rows, canApprove, showPay }: { rows: Row[]; canApprove: boolean; showPay: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  const actionable = rows.filter((r) => !['paid'].includes(r.status));
  const all = actionable.length > 0 && sel.length === actionable.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <ActionForm action={reviewTimesheets} onSuccess={() => setSel([])}>
      {sel.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
      <div className={cx('sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur', !sel.length && 'text-stone-400')}>
        <span className="text-sm font-medium">{sel.length} selected</span>
        <Input name="notes" placeholder="Note to employee (required to reject)" className="h-8 max-w-xs flex-1 text-xs" disabled={!sel.length} />
        <SubmitButton name="decision" value="under_review" variant="secondary" size="sm" disabled={!sel.length}>Mark under review</SubmitButton>
        {canApprove && <>
          <SubmitButton name="decision" value="approve" variant="success" size="sm" disabled={!sel.length}>Approve</SubmitButton>
          <SubmitButton name="decision" value="reject" variant="danger" size="sm" disabled={!sel.length}>Reject</SubmitButton>
        </>}
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? [] : actionable.map((r) => r.id))} className="accent-sage-700" /></Th>
            <Th>Employee</Th><Th>Date</Th><Th>Job</Th><Th>In / out</Th><Th>Break</Th><Th>Hours</Th>{showPay && <Th>Est. pay</Th>}<Th>Status</Th><Th>Flags</Th><Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cx(sel.includes(r.id) && 'bg-sage-50/60')}>
              <Td><input type="checkbox" aria-label={`Select ${r.employee} ${r.date}`} disabled={r.status === 'paid'} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} className="accent-sage-700" /></Td>
              <Td className="font-medium text-ink"><Link href={`/admin/employees/${r.employee_id}`} className="hover:text-sage-700">{r.employee}</Link></Td>
              <Td className="whitespace-nowrap">{r.date}</Td>
              <Td>{r.job_id ? <Link href={`/admin/jobs/${r.job_id}`} className="hover:text-sage-700">{r.job}</Link> : <span className="text-stone-400">—</span>}{r.is_manual && <Badge tone="violet" className="ml-1">Manual</Badge>}</Td>
              <Td className="whitespace-nowrap tabular-nums">{r.inLabel} – {r.outLabel}</Td>
              <Td className="tabular-nums">{r.break_minutes}m</Td>
              <Td className="font-medium tabular-nums">{Number(r.total_hours).toFixed(2)}</Td>
              {showPay && <Td className="tabular-nums">{r.earnings}</Td>}
              <Td><StatusBadge map={TS_STATUS} value={r.status} />{r.review_notes && <div className="mt-1 max-w-40 text-xs text-stone-500">{r.review_notes}</div>}</Td>
              <Td><Flags flags={r.flags} />{r.notes && <div className="mt-1 max-w-40 text-xs text-stone-500">“{r.notes}”</div>}</Td>
              <Td>{r.editable && <Link href={`/admin/timesheets/${r.id}`} className="text-xs font-medium text-sage-700 hover:underline">Edit</Link>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </ActionForm>
  );
}
