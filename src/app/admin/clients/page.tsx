import Link from 'next/link';
import { requireRole, STAFF } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Table, Th, Td, Badge, Field, Input, Select, Textarea, Empty, DemoTag, buttonClass } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createClientRecord } from '../_actions/clients';

export const metadata = { title: 'Clients & Properties' };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireRole(STAFF);
  const { q, status } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from('clients').select('id,name,email,phone,status,is_demo,properties(id,name,address,is_active)').order('name');
  if (q) query = query.or(`name.ilike.%${q.replace(/[%,()]/g, '')}%,email.ilike.%${q.replace(/[%,()]/g, '')}%`);
  if (status) query = query.eq('status', status);
  const { data } = await query;
  const list = (data ?? []) as any[];

  return (
    <>
      <PageHeader title="Clients & Properties" subtitle={`${list.length} clients · ${list.reduce((a, c) => a + (c.properties?.length ?? 0), 0)} properties`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <form className="flex flex-wrap gap-2 border-b border-stone-100 p-4" action="/admin/clients">
            <Input name="q" defaultValue={q ?? ''} placeholder="Search name or email" className="max-w-xs" />
            <Select name="status" defaultValue={status ?? ''} className="w-40">
              <option value="">All statuses</option>{['lead', 'active', 'paused', 'inactive'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
            <button className={buttonClass('secondary')}>Search</button>
          </form>
          {list.length === 0 ? <Empty title="No clients found">Add your first client on the right.</Empty> : (
            <Table>
              <thead><tr><Th>Client</Th><Th>Contact</Th><Th>Properties</Th><Th>Status</Th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <Td><Link href={`/admin/clients/${c.id}`} className="font-medium text-ink hover:text-sage-700">{c.name}</Link> <DemoTag show={c.is_demo} /></Td>
                    <Td>{c.email ?? '—'}<div className="text-xs text-stone-500">{c.phone}</div></Td>
                    <Td>{(c.properties ?? []).map((p: any) => <div key={p.id}><Link className="text-sm hover:text-sage-700" href={`/admin/properties/${p.id}`}>{p.name}</Link> <span className="text-xs text-stone-500">{p.address}</span></div>)}</Td>
                    <Td><Badge tone={c.status === 'active' ? 'green' : c.status === 'lead' ? 'blue' : 'gray'}>{titleCase(c.status)}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="New client" subtitle="Add properties on the next screen" />
          <CardBody>
            <ActionForm action={createClientRecord} redirectTo="/admin/clients/{id}" className="space-y-3">
              <Field label="Client name"><Input name="name" required /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Phone"><Input name="phone" type="tel" /></Field>
              <Field label="Billing address"><Input name="billing_address" /></Field>
              <Field label="Status">
                <Select name="status" defaultValue="active">{['lead', 'active', 'paused', 'inactive'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
              </Field>
              <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
              <SubmitButton className="w-full">Create client</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
