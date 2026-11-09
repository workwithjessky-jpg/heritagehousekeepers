import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { signIn } from './actions';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell>
      <h1 className="text-center text-lg font-semibold text-ink">Sign in to the Operations Hub</h1>
      <p className="mt-1 text-center text-sm text-stone-500">Managers and cleaners use the same sign-in.</p>
      <ActionForm action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required inputMode="email" /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full" size="lg" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-sage-700 hover:underline">Forgot your password?</Link>
      </p>
    </AuthShell>
  );
}
