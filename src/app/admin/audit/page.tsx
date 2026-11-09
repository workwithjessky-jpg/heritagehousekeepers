import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Card, PageHeader, Table, Th, Td, Badge, Input, Select, Empty, buttonClass } from '@/components/ui';
import Link from 'next/link';

export const metadata = { title: 'Audit log' };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; page?: string; q?: string }> }) {
  await requireRole(['owner']);
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (sp.entity) q = q.eq('entity', sp.entity);
  if (sp.q) q = q.ilike('action', `%${sp.q.replace(/[%_]/g, '')}%`);
  const [{ data, count }, { data: users }] = await Promise.all([q, supabase.from('users').select('id,full_name')]);
  const name = new Map((users ?? []).map((u: any) => [u.id, u.full_name]));
  const entities = ['cleaning_jobs', 'timesheets', 'timesheet_adjustments', 'payroll_periods', 'attendance_records', 'time_off_requests', 'users', 'employee_profiles', 'clients', 'properties', 'property_access_codes', 'company_settings'];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every sensitive change — who, what and when. Read-only." />
      <Card className="mb-4 p-4">
        <form className="flex flex-wrap gap-2" action="/admin/audit">
          <Select name="entity" defaultValue={sp.entity ?? ''} className="w-56"><option value="">All records</option>{entities.map((e) => <option key={e} value={e}>{titleCase(e)}</option>)}</Select>
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Action (e.g. approve)" className="w-48" />
          <button className={buttonClass('secondary')}>Filter</button>
        </form>
      </Card>
      <Card>
        {(data ?? []).length === 0 ? <Empty title="No audit entries" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Details</Th></tr></thead>
            <tbody>
              {(data as any[]).map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.created_at, tz)}</Td>
                  <Td>{a.actor_id ? name.get(a.actor_id) ?? 'Former user' : <Badge>System</Badge>}</Td>
                  <Td><Badge tone={a.action.includes('delete') || a.action.includes('reject') ? 'red' : a.action.includes('approve') || a.action.includes('paid') ? 'green' : 'gray'}>{a.action}</Badge></Td>
                  <Td className="text-xs">{titleCase(a.entity)}<div className="font-mono text-stone-400">{a.entity_id?.slice(0, 8)}</div></Td>
                  <Td><pre className="max-w-xl overflow-x-auto rounded-lg bg-stone-50 p-2 text-[11px] leading-snug text-stone-600">{summarize(a.details)}</pre></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-stone-100 px-5 py-3 text-sm">
          <span className="text-stone-500">{count ?? 0} entries</span>
          <span className="flex gap-2">
            {page > 0 && <Link className={buttonClass('secondary', 'sm')} href={`/admin/audit?${new URLSearchParams({ ...clean(sp), page: String(page - 1) })}`}>Newer</Link>}
            {(count ?? 0) > (page + 1) * PAGE && <Link className={buttonClass('secondary', 'sm')} href={`/admin/audit?${new URLSearchParams({ ...clean(sp), page: String(page + 1) })}`}>Older</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}

function clean(o: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v && k !== 'page')) as Record<string, string>;
}

function summarize(d: any) {
  if (!d) return '—';
  // hide secret values from access-code rows even in the audit view
  const s = JSON.stringify(d, (k, v) => (['entry_code', 'lockbox_code', 'alarm_code'].includes(k) && v ? '••••' : v), 2);
  return s.length > 1200 ? s.slice(0, 1200) + '…' : s;
}
