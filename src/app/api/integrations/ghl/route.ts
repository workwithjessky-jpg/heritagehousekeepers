import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkWebhookKey, handleGhlEvent, parseGhlPayload } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

// POST /api/integrations/ghl?key=<GHL_WEBHOOK_SECRET>
// Target of a GoHighLevel Workflow "Webhook" action (Contact Created / Tag Added / Appointment
// booked, rescheduled or cancelled). Always answers 200 for valid keys so GHL doesn't retry-storm;
// problems are recorded in Settings → Integrations.
export async function POST(req: NextRequest) {
  if (!checkWebhookKey(req.nextUrl.searchParams.get('key') ?? req.headers.get('x-webhook-key'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }

  const db = createAdminClient();
  const ev = parseGhlPayload(body);
  const log = (status: string, message: string, extra: Record<string, any> = {}) => db.from('integration_events').insert({
    direction: 'in', event: ev.kind === 'appointment' ? `appointment_${ev.appointment?.status ?? 'booked'}` : 'contact',
    external_id: ev.appointment?.id ?? ev.contact?.id ?? null, status, message, payload: body, ...extra,
  });

  try {
    const r = await handleGhlEvent(db, ev);
    await log(r.status, r.message, { client_id: r.client_id ?? null, job_id: r.job_id ?? null });
    return NextResponse.json(r);
  } catch (e: any) {
    await log('failed', String(e?.message ?? e).slice(0, 500));
    return NextResponse.json({ status: 'failed', message: String(e?.message ?? e) }, { status: 200 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, info: 'GoHighLevel webhook endpoint. Send POST requests from a GHL workflow.' });
}
