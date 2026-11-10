import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import { pushKeys } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET /api/push/key — the public (VAPID) key a phone needs to subscribe. Signed-in users only.
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const { publicKey } = await pushKeys(createAdminClient());
  return NextResponse.json({ publicKey });
}
