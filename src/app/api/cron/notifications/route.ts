import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { CHANNELS } from '@/lib/notify/channels';
import { retryFailedGhlSyncs } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

// Drains the notification_deliveries outbox (email today; SMS/WhatsApp ready).
// Called by Vercel Cron with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = createAdminClient();
  const { data: queue, error } = await db.from('notification_deliveries')
    .select('id,channel,destination,attempts,notification:notifications(title,body,link)')
    .eq('status', 'queued').lt('attempts', 5).order('created_at').limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const d of (queue ?? []) as any[]) {
    const ch = CHANNELS[d.channel as keyof typeof CHANNELS];
    if (!ch?.configured()) {
      await db.from('notification_deliveries').update({ status: 'skipped', last_error: `${d.channel} provider not configured` }).eq('id', d.id);
      skipped++; continue;
    }
    try {
      await ch.send(d.destination, d.notification);
      await db.from('notification_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: d.attempts + 1 }).eq('id', d.id);
      sent++;
    } catch (e: any) {
      await db.from('notification_deliveries').update({ status: d.attempts + 1 >= 5 ? 'failed' : 'queued', attempts: d.attempts + 1, last_error: String(e.message).slice(0, 500) }).eq('id', d.id);
      failed++;
    }
  }
  const ghlRetried = await retryFailedGhlSyncs(db);
  return NextResponse.json({ sent, failed, skipped, ghlRetried });
}
