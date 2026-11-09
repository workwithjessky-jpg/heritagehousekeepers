import Link from 'next/link';
import { Plane, Bell, ChevronRight, LogOut, FileText, ShieldCheck } from 'lucide-react';
import { requireRole, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtPlainDate, titleCase } from '@/lib/format';
import { Card, CardHeader, CardBody, Field, Input, Checkbox } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { updateMyProfile, changePassword } from '../actions';

export const metadata = { title: 'My profile' };

export default async function CleanerProfile() {
  const me = await requireRole(['cleaner']);
  const s = await getSettings();
  const supabase = await createClient();
  const [{ data: u }, { data: p }, { data: docs }] = await Promise.all([
    supabase.from('users').select('*').eq('id', me.id).single(),
    supabase.from('employee_profiles').select('*').eq('user_id', me.id).single(),
    supabase.from('employee_documents').select('id,name,category,storage_path,expires_on').order('created_at', { ascending: false }),
  ]);
  const signed = (docs ?? []).length ? (await supabase.storage.from('employee-documents').createSignedUrls((docs ?? []).map((d: any) => d.storage_path), 600)).data ?? [] : [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">{me.full_name}</h1>
      <p className="-mt-3 text-sm text-stone-500">{p?.job_title}{p?.team && ` · ${p.team} team`}{p?.hire_date && ` · since ${fmtPlainDate(p.hire_date)}`}</p>

      <Card>
        <ul className="divide-y divide-stone-100">
          <NavRow href="/app/time-off" icon={<Plane className="size-5" />} label="Time off & availability" />
          <NavRow href="/app/notifications" icon={<Bell className="size-5" />} label="Notifications" />
        </ul>
      </Card>

      <Card>
        <CardHeader title="My details" />
        <CardBody>
          <ActionForm action={updateMyProfile} className="space-y-3">
            <Field label="Full name"><Input name="full_name" defaultValue={u?.full_name} required className="h-12 text-base" /></Field>
            <Field label="Phone"><Input name="phone" type="tel" defaultValue={u?.phone ?? ''} className="h-12 text-base" /></Field>
            <Field label="Home address"><Input name="address" defaultValue={p?.address ?? ''} className="h-12 text-base" /></Field>
            <Field label="Emergency contact name"><Input name="emergency_contact_name" defaultValue={p?.emergency_contact_name ?? ''} className="h-12 text-base" /></Field>
            <Field label="Emergency contact phone"><Input name="emergency_contact_phone" type="tel" defaultValue={p?.emergency_contact_phone ?? ''} className="h-12 text-base" /></Field>
            <Checkbox name="email_notifications" defaultChecked={u?.email_notifications} label="Email me notifications too" />
            <p className="text-xs text-stone-500">Email: {u?.email} (ask the office to change it)</p>
            <SubmitButton size="lg" className="w-full">Save</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" />Location policy</span>} />
        <CardBody className="text-sm text-stone-700">
          <p className="whitespace-pre-wrap">{s.location_policy_text}</p>
          <p className="mt-2 text-stone-500">{p?.location_consent_at ? `You accepted this on ${fmtDateTime(p.location_consent_at, s.timezone)}.` : 'You will be asked to accept this at your first clock-in.'}</p>
        </CardBody>
      </Card>

      {(docs ?? []).length > 0 && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><FileText className="size-4" />My documents</span>} />
          <ul className="divide-y divide-stone-100 text-sm">
            {(docs as any[]).map((d) => (
              <li key={d.id} className="px-5 py-3">
                <a className="font-medium text-sage-700" href={signed.find((x: any) => x.path === d.storage_path)?.signedUrl ?? '#'} target="_blank" rel="noreferrer">{d.name}</a>
                <div className="text-xs text-stone-500">{titleCase(d.category)}{d.expires_on && ` · expires ${fmtPlainDate(d.expires_on)}`}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Change password" />
        <CardBody>
          <ActionForm action={changePassword} resetOnSuccess className="space-y-3">
            <Input name="password" type="password" minLength={10} placeholder="New password (10+ characters)" autoComplete="new-password" required className="h-12 text-base" />
            <Input name="confirm" type="password" minLength={10} placeholder="Confirm new password" autoComplete="new-password" required className="h-12 text-base" />
            <SubmitButton variant="secondary" className="w-full">Update password</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <form action="/auth/signout" method="post">
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white py-3.5 font-medium text-stone-700"><LogOut className="size-5" />Sign out</button>
      </form>
    </div>
  );
}

function NavRow({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <li><Link href={href} className="flex items-center gap-3 px-5 py-4 text-[15px] text-ink active:bg-stone-50"><span className="text-sage-700">{icon}</span><span className="flex-1">{label}</span><ChevronRight className="size-4 text-stone-400" /></Link></li>
  );
}
