import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { geocodeAddress } from './geocode';
import { zonedToUtc } from './format';

/**
 * GoHighLevel integration.
 *
 * INBOUND  — a GHL Workflow "Webhook" action POSTs to /api/integrations/ghl?key=<GHL_WEBHOOK_SECRET>.
 *            Contacts become clients + properties; calendar appointments become cleaning jobs.
 * OUTBOUND — when a job is completed, the client's GHL contact gets a tag (GHL_COMPLETED_TAG)
 *            through the GHL API (GHL_PRIVATE_TOKEN), so a GHL workflow can send review requests etc.
 */

/** Env values pasted into dashboards often pick up spaces, newlines or quotes — strip them. */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^["']|["']$/g, '').trim();
export const webhookSecret = () => clean(process.env.GHL_WEBHOOK_SECRET);
export const privateToken = () => clean(process.env.GHL_PRIVATE_TOKEN);

export const ghlConfigured = {
  inbound: () => Boolean(webhookSecret()),
  outbound: () => Boolean(privateToken()),
};

export function checkWebhookKey(key: string | null) {
  const secret = webhookSecret();
  key = key?.trim() ?? null;
  if (!secret || !key) return false;
  const a = Buffer.from(key), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ payload parsing
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export type GhlContact = { id: string; name: string; email: string | null; phone: string | null; address: string | null; tags: string[] };
export type GhlAppointment = {
  id: string; start: string; end: string | null; status: string; title: string; calendarName: string; notes: string | null; timezone: string | null; address: string | null;
};
export type GhlEvent = {
  kind: 'appointment' | 'contact';
  contact: GhlContact | null;
  appointment: GhlAppointment | null;
  cleaningType: string | null;
  price: number | null;
  instructions: string | null;
  test: boolean;
};

/** Normalises the GHL workflow webhook body (standard contact fields + `calendar` object + custom data). */
export function parseGhlPayload(body: any): GhlEvent {
  const cd = body?.customData ?? body?.custom_data ?? {};
  const pick = (...keys: string[]) => { for (const k of keys) { const v = s(cd[k] ?? body?.[k]); if (v) return v; } return ''; };

  const contactId = s(body?.contact_id ?? body?.contactId ?? body?.contact?.id ?? cd.contact_id);
  const first = s(body?.first_name ?? body?.contact?.firstName), last = s(body?.last_name ?? body?.contact?.lastName);
  const name = s(body?.full_name ?? body?.contact?.name) || [first, last].filter(Boolean).join(' ') || s(body?.company_name) || s(body?.email) || 'GHL contact';
  const addrParts = [s(body?.address1 ?? body?.contact?.address1), s(body?.city ?? body?.contact?.city), [s(body?.state ?? body?.contact?.state), s(body?.postal_code ?? body?.contact?.postalCode)].filter(Boolean).join(' ')].filter(Boolean);
  const address = s(body?.full_address) || (addrParts.length ? addrParts.join(', ') : '') || null;
  const tags = Array.isArray(body?.tags) ? body.tags.map(s) : s(body?.tags) ? s(body.tags).split(',').map((t: string) => t.trim()) : [];

  const cal = body?.calendar ?? body?.appointment ?? null;
  const apptId = s(cal?.appointmentId ?? cal?.appointment_id ?? cal?.id ?? body?.appointment_id ?? cd.appointment_id);
  const start = s(cal?.startTime ?? cal?.start_time ?? body?.start_time ?? cd.start_time);
  const appointment: GhlAppointment | null = apptId && start ? {
    id: apptId, start, end: s(cal?.endTime ?? cal?.end_time ?? body?.end_time ?? cd.end_time) || null,
    status: (s(cal?.appoinmentStatus ?? cal?.appointmentStatus ?? cal?.status ?? cd.status) || 'booked').toLowerCase(),
    title: s(cal?.title), calendarName: s(cal?.calendarName ?? cal?.calendar_name), notes: s(cal?.notes) || null,
    timezone: s(cal?.selectedTimezone ?? cal?.timezone ?? body?.timezone) || null, address: s(cal?.address) || null,
  } : null;

  const priceStr = pick('price', 'job_price');
  return {
    kind: appointment ? 'appointment' : 'contact',
    contact: contactId ? { id: contactId, name, email: s(body?.email ?? body?.contact?.email).toLowerCase() || null, phone: s(body?.phone ?? body?.contact?.phone) || null, address, tags } : null,
    appointment,
    cleaningType: pick('cleaning_type', 'service', 'service_type') || null,
    price: priceStr && !Number.isNaN(Number(priceStr)) ? Number(priceStr) : null,
    instructions: pick('instructions', 'job_notes') || null,
    test: pick('test') === 'true',
  };
}

/** GHL times may carry an offset ("…-05:00"/"Z") or be wall-clock time in the calendar's time zone. */
export function ghlTimeToUtc(value: string, tz: string) {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(value)) return new Date(value).toISOString();
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) { const d = new Date(value); if (Number.isNaN(d.getTime())) throw new Error(`Unrecognised time "${value}"`); return d.toISOString(); }
  return zonedToUtc(`${m[1]}T${m[2]}`, tz);
}

// ------------------------------------------------------------------ inbound sync
type Db = SupabaseClient;
type Result = { status: 'ok' | 'ignored'; message: string; client_id?: string; job_id?: string };

async function upsertClient(db: Db, c: GhlContact, test: boolean) {
  let { data: existing } = await db.from('clients').select('id,name').eq('ghl_contact_id', c.id).maybeSingle();
  if (!existing && c.email) {
    ({ data: existing } = await db.from('clients').select('id,name').is('ghl_contact_id', null).ilike('email', c.email).limit(1).maybeSingle());
  }
  const fields = { name: c.name, email: c.email, phone: c.phone, billing_address: c.address, ghl_contact_id: c.id };
  if (existing) {
    const { error } = await db.from('clients').update(fields).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id as string, created: false };
  }
  const { data, error } = await db.from('clients').insert({ ...fields, status: 'active', is_demo: test, notes: 'Created from GoHighLevel' }).select('id').single();
  if (error) throw error;
  return { id: data.id as string, created: true };
}

const norm = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '');

async function upsertProperty(db: Db, clientId: string, address: string, test: boolean, cleaningType: string | null) {
  const { data: props } = await db.from('properties').select('id,address').eq('client_id', clientId);
  const hit = (props ?? []).find((p: any) => norm(p.address) === norm(address));
  if (hit) return { id: hit.id as string, created: false, geocoded: true };
  const g = await geocodeAddress(address);
  const { data, error } = await db.from('properties').insert({
    client_id: clientId, name: address.split(',')[0] || 'Residence', address, latitude: g?.lat ?? null, longitude: g?.lng ?? null,
    cleaning_type: cleaningType, is_demo: test, special_instructions: null,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id as string, created: true, geocoded: !!g };
}

export async function handleGhlEvent(db: Db, ev: GhlEvent): Promise<Result> {
  if (!ev.contact) return { status: 'ignored', message: 'No contact id in payload' };
  const { data: settings } = await db.from('company_settings').select('*').eq('id', 1).single();
  const tz = settings?.timezone ?? 'America/New_York';
  const client = await upsertClient(db, ev.contact, ev.test);
  const notes: string[] = [client.created ? 'client created' : 'client updated'];

  const address = ev.appointment?.address || ev.contact.address;
  let propertyId: string | null = null;
  if (address) {
    const p = await upsertProperty(db, client.id, address, ev.test, ev.cleaningType);
    propertyId = p.id;
    if (p.created) notes.push(p.geocoded ? 'property created (mapped)' : 'property created (address not found on map — add coordinates)');
  }
  if (ev.kind === 'contact' || !ev.appointment) return { status: 'ok', message: notes.join(', '), client_id: client.id };

  const a = ev.appointment;
  const { data: job } = await db.from('cleaning_jobs').select('id,status,scheduled_start,scheduled_end').eq('ghl_appointment_id', a.id).maybeSingle();
  const cancelled = ['cancelled', 'canceled', 'invalid', 'noshow', 'no_show'].includes(a.status);

  if (job) {
    if (['completed'].includes(job.status)) return { status: 'ignored', message: 'job already completed', client_id: client.id, job_id: job.id };
    if (cancelled) {
      if (job.status !== 'cancelled') {
        const { error } = await db.from('cleaning_jobs').update({ status: 'cancelled', cancelled_reason: `Cancelled in GoHighLevel (${a.status})` }).eq('id', job.id);
        if (error) throw error;
      }
      return { status: 'ok', message: 'job cancelled', client_id: client.id, job_id: job.id };
    }
    const start = ghlTimeToUtc(a.start, a.timezone || tz);
    const end = a.end ? ghlTimeToUtc(a.end, a.timezone || tz) : new Date(new Date(start).getTime() + 3 * 36e5).toISOString();
    const patch: Record<string, any> = {};
    if (new Date(start).getTime() !== new Date(job.scheduled_start).getTime() || new Date(end).getTime() !== new Date(job.scheduled_end).getTime()) {
      patch.scheduled_start = start; patch.scheduled_end = end;
    }
    if (job.status === 'cancelled') patch.status = 'scheduled';
    if (propertyId) patch.property_id = propertyId;
    if (Object.keys(patch).length) {
      const { error } = await db.from('cleaning_jobs').update(patch).eq('id', job.id);
      if (error) throw error;
    }
    return { status: 'ok', message: patch.scheduled_start ? 'job rescheduled' : 'job unchanged', client_id: client.id, job_id: job.id };
  }

  if (cancelled) return { status: 'ignored', message: 'cancelled appointment with no matching job', client_id: client.id };
  if (!propertyId) {
    return { status: 'ignored', message: 'Booking has no address — add the address to the GHL contact so the job can be created', client_id: client.id };
  }
  const types: string[] = settings?.job_types ?? ['Standard Residential'];
  const type = (ev.cleaningType && types.find((t) => t.toLowerCase() === ev.cleaningType!.toLowerCase()))
    ?? types.find((t) => `${a.title} ${a.calendarName}`.toLowerCase().includes(t.toLowerCase().split(' ')[0]))
    ?? types[0];
  const { data: checklist } = await db.from('cleaning_checklists').select('id').eq('cleaning_type', type).eq('is_active', true).limit(1).maybeSingle();
  const price = ev.price ?? (settings?.service_pricing ?? []).find((p: any) => p.service === type)?.price ?? null;
  const start = ghlTimeToUtc(a.start, a.timezone || tz);
  const end = a.end ? ghlTimeToUtc(a.end, a.timezone || tz) : new Date(new Date(start).getTime() + 3 * 36e5).toISOString();
  const { data: created, error } = await db.from('cleaning_jobs').insert({
    client_id: client.id, property_id: propertyId, checklist_id: checklist?.id ?? null, title: `${ev.contact.name} — ${type}`, cleaning_type: type,
    scheduled_start: start, scheduled_end: end, price, instructions: [ev.instructions, a.notes].filter(Boolean).join('\n') || null,
    status: 'scheduled', source: 'ghl', ghl_appointment_id: a.id, is_demo: ev.test,
  }).select('id').single();
  if (error) throw error;
  await db.rpc('notify_staff', {
    p_event: 'schedule_change', p_type: 'ghl_booking', p_title: 'New booking from GoHighLevel',
    p_body: `${ev.contact.name} — ${type}. Needs a cleaner.`, p_link: `/admin/jobs/${created.id}`, p_roles: ['owner', 'ops_manager', 'office_admin'],
  });
  return { status: 'ok', message: `${notes.join(', ')}, job created`, client_id: client.id, job_id: created.id };
}

// ------------------------------------------------------------------ outbound (job completed → GHL tag)
const GHL_API = 'https://services.leadconnectorhq.com';

async function ghlAddTag(contactId: string, tag: string) {
  const res = await fetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${privateToken()}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ tags: [tag] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GHL ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Called after a job completes. Never throws — failures are logged and retried by the cron worker. */
export async function syncJobCompleted(db: Db, jobId: string) {
  try {
    const { data: job } = await db.from('cleaning_jobs').select('id,status,client:clients(id,ghl_contact_id)').eq('id', jobId).single();
    const contactId = (job as any)?.client?.ghl_contact_id;
    if (!job || job.status !== 'completed' || !contactId) return;
    const tag = process.env.GHL_COMPLETED_TAG || 'cleaning-completed';
    const { data: already } = await db.from('integration_events').select('id').eq('direction', 'out').eq('job_id', jobId).eq('status', 'ok').limit(1).maybeSingle();
    if (already) return;
    if (!ghlConfigured.outbound()) {
      await db.from('integration_events').insert({ direction: 'out', event: 'job_completed', external_id: contactId, status: 'ignored', message: 'GHL_PRIVATE_TOKEN not set', job_id: jobId, client_id: (job as any).client.id });
      return;
    }
    try {
      await ghlAddTag(contactId, tag);
      await db.from('integration_events').insert({ direction: 'out', event: 'job_completed', external_id: contactId, status: 'ok', message: `tagged "${tag}"`, job_id: jobId, client_id: (job as any).client.id });
    } catch (e: any) {
      await db.from('integration_events').insert({ direction: 'out', event: 'job_completed', external_id: contactId, status: 'failed', message: String(e.message).slice(0, 500), job_id: jobId, client_id: (job as any).client.id, payload: { tag } });
    }
  } catch {
    // never block the cleaner's clock-out on the integration
  }
}

/** Retries failed outbound syncs (called from the notifications cron). */
export async function retryFailedGhlSyncs(db: Db) {
  if (!ghlConfigured.outbound()) return 0;
  const { data } = await db.from('integration_events').select('id,external_id,attempts,payload').eq('direction', 'out').eq('status', 'failed').lt('attempts', 5).limit(20);
  let n = 0;
  for (const ev of (data ?? []) as any[]) {
    try {
      await ghlAddTag(ev.external_id, ev.payload?.tag || process.env.GHL_COMPLETED_TAG || 'cleaning-completed');
      await db.from('integration_events').update({ status: 'ok', attempts: ev.attempts + 1, message: 'tagged on retry' }).eq('id', ev.id);
      n++;
    } catch (e: any) {
      await db.from('integration_events').update({ attempts: ev.attempts + 1, message: String(e.message).slice(0, 500) }).eq('id', ev.id);
    }
  }
  return n;
}
