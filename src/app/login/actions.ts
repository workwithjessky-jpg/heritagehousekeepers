'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/actions';

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  const next = String(fd.get('next') ?? '');
  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, error: 'Incorrect email or password.' };

  const { data: profile } = await supabase.from('users').select('role_key,is_active').eq('id', data.user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, error: 'Your account is inactive. Please contact the office.' };
  }
  const home = profile.role_key === 'cleaner' ? '/app' : '/admin';
  const safeNext = next.startsWith(home) ? next : home; // never redirect into the other portal or off-site
  redirect(safeNext);
}

export async function requestPasswordReset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Enter your email.' };
  const supabase = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/confirm?next=/auth/set-password` });
  // Same message whether or not the account exists (prevents account enumeration)
  return { ok: true, message: 'If that email has an account, a reset link is on its way.' };
}

export async function setPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  if (password.length < 10) return { ok: false, error: 'Use at least 10 characters.' };
  if (password !== confirm) return { ok: false, error: 'Passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
