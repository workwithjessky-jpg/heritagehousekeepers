import Link from 'next/link';
import { Camera } from 'lucide-react';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Badge, Checkbox, cx } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { createChecklist, updateChecklist, addTask, updateTask } from '../_actions/settings';

export const metadata = { title: 'Checklists' };

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const me = await requireRole(STAFF);
  const { id } = await searchParams;
  const s = await getSettings();
  const supabase = await createClient();
  const { data: lists } = await supabase.from('cleaning_checklists').select('*, checklist_tasks(count)').order('name');
  const current = (lists ?? []).find((l: any) => l.id === id) ?? (lists ?? [])[0];
  const { data: tasks } = current ? await supabase.from('checklist_tasks').select('*').eq('checklist_id', current.id).order('sort_order') : { data: [] };
  const edit = isSupervisor(me.role);

  return (
    <>
      <PageHeader title="Cleaning checklists" subtitle="Templates cleaners complete on their phones. Required tasks must be done (or explained) before a job can be completed." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Card className="p-2">
            {(lists ?? []).map((l: any) => (
              <Link key={l.id} href={`/admin/checklists?id=${l.id}`} className={cx('block rounded-xl px-3 py-2', current?.id === l.id ? 'bg-sage-100' : 'hover:bg-stone-50')}>
                <div className="text-sm font-medium text-ink">{l.name} {!l.is_active && <Badge>Inactive</Badge>}</div>
                <div className="text-xs text-stone-500">{l.cleaning_type} · {l.checklist_tasks?.[0]?.count ?? 0} tasks</div>
              </Link>
            ))}
          </Card>
          {edit && (
            <Card>
              <CardHeader title="New template" />
              <CardBody>
                <ActionForm action={createChecklist} redirectTo="/admin/checklists?id={id}" className="space-y-2">
                  <Input name="name" placeholder="Template name" required />
                  <Select name="cleaning_type" defaultValue={(s.job_types ?? [])[0]}>{(s.job_types ?? []).map((t: string) => <option key={t}>{t}</option>)}</Select>
                  <Select name="copy_from" defaultValue=""><option value="">Start empty</option>{(lists ?? []).map((l: any) => <option key={l.id} value={l.id}>Copy tasks from {l.name}</option>)}</Select>
                  <SubmitButton size="sm" className="w-full">Create</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>

        {current && (
          <div className="space-y-6">
            <Card>
              <CardHeader title={current.name} subtitle={current.description} />
              <CardBody>
                {edit ? (
                  <ActionForm action={updateChecklist} className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={current.id} />
                    <Field label="Name"><Input name="name" defaultValue={current.name} required /></Field>
                    <Field label="Cleaning type"><Select name="cleaning_type" defaultValue={current.cleaning_type}>{[...new Set([current.cleaning_type, ...(s.job_types ?? [])])].map((t: string) => <option key={t}>{t}</option>)}</Select></Field>
                    <Field label="Description" className="sm:col-span-2"><Textarea name="description" rows={2} defaultValue={current.description ?? ''} /></Field>
                    <Checkbox name="is_active" defaultChecked={current.is_active} label="Active (available when scheduling)" />
                    <div className="sm:col-span-2"><SubmitButton variant="secondary" size="sm">Save template</SubmitButton></div>
                  </ActionForm>
                ) : <p className="text-sm text-stone-500">View only — supervisors can edit templates.</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Tasks" subtitle="Grouped by room / area in the cleaner app" />
              <div className="divide-y divide-stone-100">
                {(tasks ?? []).map((t: any) => edit ? (
                  <ActionForm key={t.id} action={updateTask} showMessage className="grid items-center gap-2 px-5 py-2.5 sm:grid-cols-[60px_140px_1fr_auto_auto_auto]">
                    <input type="hidden" name="id" value={t.id} />
                    <Input name="sort_order" type="number" defaultValue={t.sort_order} className="h-8 text-xs" aria-label="Order" />
                    <Input name="area" defaultValue={t.area} className="h-8 text-xs" aria-label="Area" />
                    <Input name="task" defaultValue={t.task} className="h-8 text-xs" aria-label="Task" />
                    <Checkbox name="is_required" defaultChecked={t.is_required} label={<span className="text-xs">Required</span>} />
                    <Checkbox name="requires_photo" defaultChecked={t.requires_photo} label={<span className="text-xs"><Camera className="inline size-3.5" /> Photo</span>} />
                    <span className="flex gap-1">
                      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                      <SubmitButton size="sm" variant="ghost" name="delete" value="1">Delete</SubmitButton>
                    </span>
                  </ActionForm>
                ) : (
                  <div key={t.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                    <span className="text-stone-400">{t.area} ·</span> {t.task} {t.is_required && <Badge>Required</Badge>} {t.requires_photo && <Badge tone="blue">Photo</Badge>}
                  </div>
                ))}
              </div>
              {edit && (
                <CardBody className="border-t border-stone-100">
                  <ActionForm action={addTask} resetOnSuccess className="grid items-end gap-2 sm:grid-cols-[60px_140px_1fr_auto_auto_auto]">
                    <input type="hidden" name="checklist_id" value={current.id} />
                    <Input name="sort_order" type="number" placeholder="#" defaultValue={((tasks ?? []).at(-1)?.sort_order ?? 0) + 1} />
                    <Input name="area" placeholder="Area (e.g. Kitchen)" required />
                    <Input name="task" placeholder="Task" required />
                    <Checkbox name="is_required" defaultChecked label={<span className="text-xs">Required</span>} />
                    <Checkbox name="requires_photo" label={<span className="text-xs">Photo</span>} />
                    <SubmitButton size="sm">Add task</SubmitButton>
                  </ActionForm>
                </CardBody>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
