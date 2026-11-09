import Link from 'next/link';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayInTz } from '@/lib/format';
import { PageHeader, Card, Empty, LinkButton } from '@/components/ui';
import { JobForm } from './job-form';

export const metadata = { title: 'New job' };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(STAFF);
  const sp = await searchParams;
  const s = await getSettings();
  const supabase = await createClient();
  const [props, lists, cleaners, parent] = await Promise.all([
    supabase.from('properties').select('id,name,address,cleaning_type,special_instructions,client:clients(name,status)').eq('is_active', true).order('name'),
    supabase.from('cleaning_checklists').select('id,name,cleaning_type').eq('is_active', true).order('name'),
    supabase.from('users').select('id,full_name,employee_profiles(team,employment_status)').eq('role_key', 'cleaner').eq('is_active', true).order('full_name'),
    sp.parent ? supabase.from('cleaning_jobs').select('title,property_id,cleaning_type').eq('id', sp.parent).single() : Promise.resolve({ data: null }),
  ]);
  const properties = ((props.data ?? []) as any[]).filter((p) => p.client?.status !== 'inactive');
  const p = parent.data as any;

  return (
    <>
      <PageHeader title={p ? 'Schedule follow-up job' : 'New cleaning job'} subtitle={p ? `Follow-up to “${p.title}”` : 'Create a one-off or recurring appointment'} />
      {properties.length === 0 ? (
        <Card><Empty title="Add a client property first">Jobs are scheduled at a property. <Link className="text-sage-700 underline" href="/admin/clients">Add a client</Link></Empty></Card>
      ) : (
        <JobForm
          properties={properties}
          checklists={lists.data ?? []}
          cleaners={((cleaners.data ?? []) as any[]).filter((c) => !['inactive', 'terminated'].includes(c.employee_profiles?.employment_status)).map((c) => ({ id: c.id, full_name: c.full_name, team: c.employee_profiles?.team ?? null }))}
          jobTypes={(s.job_types as string[]) ?? []}
          pricing={(s.service_pricing as any[]) ?? []}
          defaults={{ property: sp.property ?? p?.property_id, date: sp.date ?? todayInTz(s.timezone), parent: sp.parent, title: p ? `Follow-up: ${p.title}` : undefined, type: p?.cleaning_type }}
        />
      )}
      <div className="mt-4"><LinkButton href="/admin/schedule" variant="ghost">Cancel</LinkButton></div>
    </>
  );
}
