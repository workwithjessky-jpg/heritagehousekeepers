import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { pushKeys, checkDispatchKey, sendPushForNotification } from '@/lib/push';

export const dynamic = 'force-dynamic';

// POST /api/push/dispatch {notification_id} — called by the database (pg_net) when a notification is created.
// Authenticated with the server-only dispatch key stored in app_secrets.
export async function POST(req: NextRequest) {
  const db = createAdminClient();
  const { dispatchKey } = await pushKeys(db);
  if (!checkDispatchKey(req.headers.get('x-push-key'), dispatchKey)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { notification_id } = await req.json().catch(() => ({}));
  if (typeof notification_id !== 'string') return NextResponse.json({ error: 'notification_id required' }, { status: 400 });
  return NextResponse.json(await sendPushForNotification(db, notification_id));
}
