import { AuthShell } from '@/components/auth-shell';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { setPassword } from '../../login/actions';

export const metadata = { title: 'Set password' };

export default function SetPasswordPage() {
  return (
    <AuthShell>
      <h1 className="text-center text-lg font-semibold text-ink">Choose a password</h1>
      <p className="mt-1 text-center text-sm text-stone-500">At least 10 characters.</p>
      <ActionForm action={setPassword} className="mt-6 space-y-4">
        <Field label="New password"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirm password"><Input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <SubmitButton className="w-full" size="lg" pendingText="Saving…">Save password</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
