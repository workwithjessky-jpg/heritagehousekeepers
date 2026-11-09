import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Handles invite, password-recovery and magic links from Supabase emails.
// In Supabase → Auth → Email Templates, point links at:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password   (Invite)
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password (Reset password)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const supabase = await createClient();

  let error: unknown = null;
  if (token_hash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = new Error('missing token');
  }
  if (error) return NextResponse.redirect(new URL('/login?error=link', request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
