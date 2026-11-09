import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtMoney, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Table, Th, Td, StatusBadge, JOB_STATUS, Empty, LinkButton, DemoTag, Badge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PropertyFields } from '@/components/property-fields';
import { updateClientRecord, createProperty } from '../../_actions/clients';

export const metadata = { title: 'Client' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(STAFF);
  const { id } = await params;
  const s = await getSettings();
  const supabase = await createClient();
  const { data: c } = await supabase.from('clients').select('*, properties(*)').eq('id', id).single();
  if (!c) notFound();
  const { data: jobs } = await supabase.from('cleaning_jobs')
    .select('id,title,scheduled_start,status,price,client_rating,property:properties(name),job_assignments(user:users!job_assignments_employee_id_fkey(full_name))')
    .eq('client_id', id).order('scheduled_start', { ascending: false }).limit(100);
  const done = (jobs ?? []).filter((j: any) => j.status === 'completed');
  const revenue = done.reduce((a: number, j: any) => a + Number(j.price ?? 0), 0);

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{c.name} <DemoTag show={c.is_demo} /></span>} subtitle={`${titleCase(c.status)} client · ${done.length} completed cleans · ${fmtMoney(revenue, s.currency)} revenue`}
        actions={<LinkButton href={`/admin/jobs/new${c.properties?.[0] ? `?property=${c.properties[0].id}` : ''}`}>Book a clean</LinkButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Properties" />
            {(c.properties ?? []).length === 0 ? <Empty title="No properties yet">Add one below so you can schedule jobs.</Empty> : (
              <ul className="divide-y divide-stone-100">
                {(c.properties as any[]).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <div>
                      <Link href={`/admin/properties/${p.id}`} className="font-medium text-ink hover:text-sage-700">{p.name}</Link> {!p.is_active && <Badge>Inactive</Badge>}
                      <div className="text-sm text-stone-500">{p.address}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {p.latitude == null ? <Badge tone="amber">No GPS coordinates</Badge> : <Badge tone="green">Geofenced {p.geofence_radius_m ?? s.default_geofence_m} m</Badge>}
                      {p.recurring_frequency !== 'none' && <Badge tone="sage">{titleCase(p.recurring_frequency)}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Cleaning history" />
            {(jobs ?? []).length === 0 ? <Empty title="No jobs yet" /> : (
              <Table>
                <thead><tr><Th>Date</Th><Th>Job</Th><Th>Cleaners</Th><Th>Price</Th><Th>Rating</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {(jobs as any[]).map((j) => (
                    <tr key={j.id} className="hover:bg-stone-50">
                      <Td className="whitespace-nowrap">{fmtDateTime(j.scheduled_start, s.timezone)}</Td>
                      <Td><Link href={`/admin/jobs/${j.id}`} className="hover:text-sage-700">{j.title}</Link><div className="text-xs text-stone-500">{j.property?.name}</div></Td>
                      <Td>{j.job_assignments?.map((a: any) => a.user?.full_name).join(', ') || '—'}</Td>
                      <Td>{j.price != null ? fmtMoney(j.price, s.currency) : '—'}</Td>
                      <Td>{j.client_rating ? '★'.repeat(j.client_rating) : '—'}</Td>
                      <Td><StatusBadge map={JOB_STATUS} value={j.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Add property" subtitle="Coordinates are looked up from the address when left blank" />
            <CardBody>
              <ActionForm action={createProperty} redirectTo="/admin/properties/{id}" className="space-y-3">
                <input type="hidden" name="client_id" value={c.id} />
                <PropertyFields jobTypes={s.job_types ?? []} defaultRadius={s.default_geofence_m} />
                <SubmitButton>Add property</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Client details" />
          <CardBody>
            <ActionForm action={updateClientRecord} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Name"><Input name="name" defaultValue={c.name} required /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={c.email ?? ''} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={c.phone ?? ''} /></Field>
              <Field label="Billing address"><Input name="billing_address" defaultValue={c.billing_address ?? ''} /></Field>
              <Field label="Status">
                <Select name="status" defaultValue={c.status}>{['lead', 'active', 'paused', 'inactive'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>
              </Field>
              <Field label="Notes"><Textarea name="notes" rows={4} defaultValue={c.notes ?? ''} /></Field>
              <SubmitButton className="w-full">Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
