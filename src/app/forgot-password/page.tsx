import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { requestPasswordReset } from '../login/actions';

export const metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <h1 className="text-center text-lg font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-center text-sm text-stone-500">We&apos;ll email you a secure link.</p>
      <ActionForm action={requestPasswordReset} className="mt-6 space-y-4" resetOnSuccess>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <SubmitButton className="w-full" size="lg" pendingText="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-sage-700 hover:underline">Back to sign in</Link></p>
    </AuthShell>
  );
}
