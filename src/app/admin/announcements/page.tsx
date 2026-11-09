import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Badge, Checkbox, Empty } from '@/components/ui';
import { ActionForm, ActionButton, SubmitButton } from '@/components/forms';
import { createAnnouncement, deleteAnnouncement } from '../_actions/people';

export const metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  await requireRole(STAFF);
  const { timezone: tz } = await getSettings();
  const supabase = await createClient();
  const { data } = await supabase.from('announcements').select('*, author:users(full_name)').order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(100);

  return (
    <>
      <PageHeader title="Announcements" subtitle="Publishing sends an in-app notification (and email, if enabled) to the chosen audience." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {(data ?? []).length === 0 ? <Empty title="No announcements yet" /> : (
            <ul className="divide-y divide-stone-100">
              {(data as any[]).map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium text-ink">{a.title} {a.pinned && <Badge tone="sage">Pinned</Badge>} <Badge>{titleCase(a.audience)}</Badge></div>
                    <ActionButton action={deleteAnnouncement} fields={{ id: a.id }} variant="ghost" confirm="Remove this announcement?">Remove</ActionButton>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{a.body}</p>
                  <div className="mt-1 text-xs text-stone-500">{a.author?.full_name} · {fmtDateTime(a.published_at, tz)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="New announcement" />
          <CardBody>
            <ActionForm action={createAnnouncement} resetOnSuccess className="space-y-3">
              <Field label="Title"><Input name="title" required /></Field>
              <Field label="Message"><Textarea name="body" rows={5} required /></Field>
              <Field label="Audience">
                <Select name="audience" defaultValue="all"><option value="all">Everyone</option><option value="cleaners">Cleaners</option><option value="management">Management</option></Select>
              </Field>
              <Checkbox name="pinned" label="Pin to top of dashboards" />
              <SubmitButton className="w-full">Publish</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
