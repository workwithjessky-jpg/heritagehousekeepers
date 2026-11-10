import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import { sendPushForNotification } from '@/lib/push';

export const dynamic = 'force-dynamic';

// POST /api/push/test — sends a test alert to the signed-in user's phones (also listed in the bell).
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const db = createAdminClient();
  const { data: n, error } = await db.from('notifications').insert({
    user_id: me.id, type: 'push_test', title: 'Phone alerts are on ✅',
    body: 'You will get alerts like this when cleaners are on the way, clock in or clock out.',
    link: me.role === 'cleaner' ? '/app' : '/admin',
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // send directly too (the database trigger does the same; duplicates are collapsed by the notification tag)
  const r = await sendPushForNotification(db, n.id);
  return NextResponse.json(r);
}
