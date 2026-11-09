import 'server-only';
import { revalidatePath } from 'next/cache';

export type ActionState = { ok: boolean; error?: string; message?: string; data?: any } | null;

/** Turns Postgres / Supabase errors into short, friendly messages. */
export function friendlyError(e: any): string {
  const msg: string = e?.message ?? String(e);
  if (/row-level security|permission denied|42501/i.test(msg)) return 'You do not have permission to do that.';
  if (/duplicate key/i.test(msg)) return 'That record already exists.';
  if (/violates foreign key/i.test(msg)) return 'This record is linked to other data and cannot be removed.';
  if (/violates check constraint "job_time_order"/.test(msg)) return 'End time must be after start time.';
  if (/violates check constraint/i.test(msg)) return 'One of the values is out of the allowed range.';
  return msg.replace(/^.*?ERROR:\s*/, '');
}

/** Runs a server-action body: catches errors, revalidates paths, returns ActionState for useActionState. */
export async function run(
  fn: () => Promise<string | void | { message?: string; data?: any }>,
  revalidate: string[] = ['/'],
): Promise<ActionState> {
  try {
    const r = await fn();
    revalidate.forEach((p) => revalidatePath(p, 'layout'));
    if (typeof r === 'string') return { ok: true, message: r };
    return { ok: true, message: r?.message ?? 'Saved', data: r?.data };
  } catch (e) {
    // let Next.js redirects propagate
    if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    return { ok: false, error: friendlyError(e) };
  }
}

/** Throws if a Supabase response carries an error, returns data otherwise. */
export function must<T>(res: { data: T; error: any }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function num(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (s == null) return null;
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`${key.replace(/_/g, ' ')} must be a number`);
  return n;
}

export function bool(fd: FormData, key: string) {
  const v = fd.get(key);
  return v === 'on' || v === 'true' || v === '1';
}

export function required(fd: FormData, key: string, label = key): string {
  const s = str(fd, key);
  if (!s) throw new Error(`${label.replace(/_/g, ' ')} is required`);
  return s;
}
