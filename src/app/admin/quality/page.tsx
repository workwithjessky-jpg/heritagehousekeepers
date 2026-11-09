import Link from 'next/link';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Card, CardHeader, PageHeader, Table, Th, Td, Badge, Empty, Tabs, StatusBadge, JOB_STATUS } from '@/components/ui';

export const metadata = { title: 'Quality Control' };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRole(STAFF);
  const { tab = 'review' } = await searchParams;
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();

  const [{ data: toReview }, { data: issues }, { data: flaggedTasks }] = await Promise.all([
    supabase.from('cleaning_jobs').select('id,title,completed_at,status,quality_status,completion_exception,property:properties(name),job_assignments(user:users!job_assignments_employee_id_fkey(full_name)),job_photos(kind),checklist_submissions(completed,flagged)')
      .in('status', ['completed', 'needs_attention']).gte('completed_at', since).order('completed_at', { ascending: false }).limit(100),
    supabase.from('job_issues').select('*, property:properties(id,name), reporter:users!job_issues_reported_by_fkey(full_name)').order('created_at', { ascending: false }).limit(200),
    supabase.from('checklist_submissions').select('id,flag_note,updated_at,job_id,task:checklist_tasks(area,task),job:cleaning_jobs(title)').eq('flagged', true).order('updated_at', { ascending: false }).limit(50),
  ]);
  const jobs = (toReview ?? []) as any[];
  const pending = jobs.filter((j) => j.quality_status === 'pending');
  const allIssues = (issues ?? []) as any[];
  const open = allIssues.filter((i) => i.status !== 'resolved');
  // recurring issues: same property + category more than once
  const rec = new Map<string, { property: any; category: string; n: number }>();
  allIssues.forEach((i) => {
    const k = `${i.property_id}:${i.category}`;
    rec.set(k, { property: i.property, category: i.category, n: (rec.get(k)?.n ?? 0) + 1 });
  });
  const recurring = [...rec.values()].filter((r) => r.n > 1).sort((a, b) => b.n - a.n);

  return (
    <>
      <PageHeader title="Quality Control" subtitle="Review completed work, photos and checklists; track property issues." />
      <Tabs active={tab} tabs={[
        { key: 'review', label: `Awaiting review (${pending.length})`, href: '/admin/quality' },
        { key: 'issues', label: `Open issues (${open.length})`, href: '/admin/quality?tab=issues' },
        { key: 'recurring', label: 'Recurring problems', href: '/admin/quality?tab=recurring' },
      ]} />

      {tab === 'review' && (
        <Card>
          {jobs.length === 0 ? <Empty title="No completed jobs in the last 30 days" /> : (
            <Table>
              <thead><tr><Th>Completed</Th><Th>Job</Th><Th>Team</Th><Th>Checklist</Th><Th>Photos</Th><Th>QC</Th></tr></thead>
              <tbody>
                {jobs.map((j) => {
                  const subs = j.checklist_submissions ?? [];
                  const before = j.job_photos?.filter((p: any) => p.kind === 'before').length ?? 0;
                  const after = j.job_photos?.filter((p: any) => p.kind === 'after').length ?? 0;
                  return (
                    <tr key={j.id} className="hover:bg-stone-50">
                      <Td className="whitespace-nowrap">{fmtDateTime(j.completed_at, tz)}</Td>
                      <Td><Link className="font-medium text-ink hover:text-sage-700" href={`/admin/jobs/${j.id}`}>{j.title}</Link><div className="text-xs text-stone-500">{j.property?.name}</div>
                        {j.completion_exception && <div className="mt-1 text-xs text-violet-800">Exception: {j.completion_exception}</div>}</Td>
                      <Td>{j.job_assignments?.map((a: any) => a.user?.full_name).join(', ')}</Td>
                      <Td>{subs.filter((x: any) => x.completed).length}/{subs.length}{subs.some((x: any) => x.flagged) && <Badge tone="red" className="ml-1">flagged</Badge>}</Td>
                      <Td>{before} before · {after} after</Td>
                      <Td>{j.status === 'needs_attention' ? <StatusBadge map={JOB_STATUS} value={j.status} /> : <Badge tone={j.quality_status === 'passed' ? 'green' : j.quality_status === 'flagged' ? 'red' : 'amber'}>{titleCase(j.quality_status)}</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {(flaggedTasks ?? []).length > 0 && (
            <div className="border-t border-stone-100 p-5">
              <h3 className="mb-2 text-sm font-semibold">Flagged checklist tasks</h3>
              <ul className="space-y-1 text-sm">
                {(flaggedTasks as any[]).map((f) => <li key={f.id}><Link className="text-sage-700 hover:underline" href={`/admin/jobs/${f.job_id}`}>{f.job?.title}</Link> — {f.task?.area}: {f.task?.task} <span className="text-red-700">({f.flag_note})</span></li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      {tab === 'issues' && (
        <Card>
          {open.length === 0 ? <Empty title="No open issues" /> : (
            <Table>
              <thead><tr><Th>Reported</Th><Th>Property</Th><Th>Category</Th><Th>Description</Th><Th>By</Th><Th>Status</Th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id}>
                    <Td className="whitespace-nowrap">{fmtDateTime(i.created_at, tz)}</Td>
                    <Td><Link className="hover:text-sage-700" href={`/admin/properties/${i.property?.id}`}>{i.property?.name}</Link></Td>
                    <Td><Badge tone="red">{titleCase(i.category)}</Badge></Td>
                    <Td className="max-w-md">{i.description} {i.job_id && <Link className="text-xs text-sage-700 underline" href={`/admin/jobs/${i.job_id}`}>open job to resolve</Link>}</Td>
                    <Td>{i.reporter?.full_name ?? titleCase(i.source)}</Td>
                    <Td>{titleCase(i.status)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'recurring' && (
        <Card>
          <CardHeader title="Same issue reported more than once at a property" />
          {recurring.length === 0 ? <Empty title="No recurring problems detected" /> : (
            <ul className="divide-y divide-stone-100 text-sm">
              {recurring.map((r) => (
                <li key={`${r.property?.id}${r.category}`} className="flex items-center justify-between px-5 py-3">
                  <Link className="font-medium hover:text-sage-700" href={`/admin/properties/${r.property?.id}`}>{r.property?.name}</Link>
                  <span><Badge tone="red">{titleCase(r.category)}</Badge> ×{r.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
