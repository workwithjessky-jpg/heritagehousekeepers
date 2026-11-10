import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/push/subscribe — save this phone's push subscription for the signed-in user.
// DELETE /api/push/subscribe — turn alerts off on this phone.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const sub = await req.json().catch(() => null);
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }
  const supabase = await createClient();
  // the same phone may have been registered by another account before — replace it
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: me.id, endpoint, p256dh, auth, user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  });
  if (error && !/duplicate/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (typeof endpoint === 'string') await (await createClient()).from('push_subscriptions').delete().eq('endpoint', endpoint);
  return NextResponse.json({ ok: true });
}
