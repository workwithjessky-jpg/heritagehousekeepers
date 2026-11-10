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
  home: GhlHome;
  test: boolean;
};
/** Details from the contact's own custom fields (Cleaning Type, Access Instructions, …). */
export type GhlHome = {
  accessInstructions: string | null; specialNotes: string | null; bedrooms: number | null; bathrooms: number | null;
  squareFeet: number | null; frequency: 'weekly' | 'biweekly' | 'monthly' | null;
};

const keyNorm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const fieldText = (v: any): string => Array.isArray(v) ? v.map(fieldText).filter(Boolean).join(', ') : s(v);
const firstNumber = (v: string) => { const m = v.replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
function toFrequency(v: string): GhlHome['frequency'] {
  const t = v.toLowerCase();
  if (/bi-?weekly|every (other|2|two) week/.test(t)) return 'biweekly';
  if (/week/.test(t)) return 'weekly';
  if (/month|4 week|four week/.test(t)) return 'monthly';
  return null;
}

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
  // A calendar's "address" is often the business's own location (where meetings happen), not the client's
  // home. Never use the business address as a cleaning property.
  const bizAddrs = [s(body?.location?.fullAddress), s(body?.location?.address)].filter(Boolean).map(keyNorm);
  const notBusiness = (a: string) => (a && !bizAddrs.some((b) => b && (keyNorm(a) === b || keyNorm(a).startsWith(b))) ? a : null);
  const apptId = s(cal?.appointmentId ?? cal?.appointment_id ?? cal?.id ?? body?.appointment_id ?? cd.appointment_id);
  const start = s(cal?.startTime ?? cal?.start_time ?? body?.start_time ?? cd.start_time);
  const appointment: GhlAppointment | null = apptId && start ? {
    id: apptId, start, end: s(cal?.endTime ?? cal?.end_time ?? body?.end_time ?? cd.end_time) || null,
    status: (s(cal?.appoinmentStatus ?? cal?.appointmentStatus ?? cal?.status ?? cd.status) || 'booked').toLowerCase(),
    title: s(cal?.title), calendarName: s(cal?.calendarName ?? cal?.calendar_name), notes: s(cal?.notes) || null,
    timezone: s(cal?.selectedTimezone ?? cal?.timezone ?? body?.timezone) || null, address: notBusiness(s(cal?.address)),
  } : null;

  // Contact custom fields arrive as top-level keys named after the field ("Cleaning Type", "# Bedrooms", …).
  const byNorm = new Map<string, any>();
  for (const [k, v] of Object.entries(body ?? {})) if (typeof v !== 'object' || Array.isArray(v)) byNorm.set(keyNorm(k), v);
  const field = (...names: string[]) => { for (const n of names) { const v = fieldText(byNorm.get(keyNorm(n))); if (v) return v; } return ''; };

  const notesParts = [
    field('Special Cleaning Notes'),
    field('Cleaning Priorities & Preferences') && `Priorities: ${field('Cleaning Priorities & Preferences')}`,
    field('Pets') && `Pets: ${field('Pets')}`,
    field('Extras') && `Extras: ${field('Extras')}`,
  ].filter(Boolean);
  const bedrooms = firstNumber(field('# Bedrooms', 'Bedrooms'));
  const bathrooms = firstNumber(field('# Bathrooms', 'Bathrooms'));
  const sqft = firstNumber(field('Approximate Square Footage', 'Home Size', 'Square Footage'));
  const home: GhlHome = {
    accessInstructions: field('Access Instructions') || null,
    specialNotes: notesParts.join('\n') || null,
    bedrooms, bathrooms, squareFeet: sqft != null ? Math.round(sqft) : null,
    frequency: toFrequency(field('Cleaning Frequency', 'Visit Frequency')),
  };

  const priceStr = pick('price', 'job_price');
  return {
    kind: appointment ? 'appointment' : 'contact',
    contact: contactId ? { id: contactId, name, email: s(body?.email ?? body?.contact?.email).toLowerCase() || null, phone: s(body?.phone ?? body?.contact?.phone) || null, address, tags } : null,
    appointment,
    // The contact's own "Cleaning Type" field wins over a fixed value in the workflow's Custom Data.
    cleaningType: field('Cleaning Type', 'Service Type') || pick('cleaning_type', 'service', 'service_type') || null,
    price: priceStr && !Number.isNaN(Number(priceStr)) ? Number(priceStr) : null,
    instructions: [pick('instructions', 'job_notes'), home.specialNotes].filter(Boolean).join('\n') || null,
    home,
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

async function upsertProperty(db: Db, clientId: string, address: string, test: boolean, cleaningType: string | null, home: GhlHome) {
  const fromGhl: Record<string, any> = {
    cleaning_type: cleaningType, access_instructions: home.accessInstructions, special_instructions: home.specialNotes,
    bedrooms: home.bedrooms, bathrooms: home.bathrooms, square_feet: home.squareFeet, recurring_frequency: home.frequency,
  };
  const { data: props } = await db.from('properties').select('id,address,cleaning_type,access_instructions,special_instructions,bedrooms,bathrooms,square_feet,recurring_frequency').eq('client_id', clientId);
  const hit: any = (props ?? []).find((p: any) => norm(p.address) === norm(address));
  if (hit) {
    // Fill in only what the office hasn't entered yet — never overwrite edits made in the Ops Hub.
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(fromGhl)) {
      const empty = hit[k] == null || hit[k] === '' || (k === 'recurring_frequency' && hit[k] === 'none');
      if (v != null && v !== '' && empty) patch[k] = v;
    }
    if (Object.keys(patch).length) { const { error } = await db.from('properties').update(patch).eq('id', hit.id); if (error) throw error; }
    return { id: hit.id as string, created: false, geocoded: true };
  }
  const g = await geocodeAddress(address);
  const { data, error } = await db.from('properties').insert({
    client_id: clientId, name: address.split(',')[0] || 'Residence', address, latitude: g?.lat ?? null, longitude: g?.lng ?? null,
    is_demo: test, ...Object.fromEntries(Object.entries(fromGhl).filter(([, v]) => v != null && v !== '')),
  }).select('id').single();
  if (error) throw error;
  return { id: data.id as string, created: true, geocoded: !!g };
}

export async function handleGhlEvent(db: Db, ev: GhlEvent, opts: { quiet?: boolean } = {}): Promise<Result> {
  if (!ev.contact) return { status: 'ignored', message: 'No contact id in payload' };
  const { data: settings } = await db.from('company_settings').select('*').eq('id', 1).single();
  const tz = settings?.timezone ?? 'America/New_York';
  const client = await upsertClient(db, ev.contact, ev.test);
  const notes: string[] = [client.created ? 'client created' : 'client updated'];

  // the client's own (contact) address first; a calendar address only when the contact has none
  const address = ev.contact.address || ev.appointment?.address;
  let propertyId: string | null = null;
  if (address) {
    const p = await upsertProperty(db, client.id, address, ev.test, ev.cleaningType, ev.home);
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
  let type = (ev.cleaningType && types.find((t) => t.toLowerCase() === ev.cleaningType!.toLowerCase()))
    ?? (ev.cleaningType ? null : types.find((t) => `${a.title} ${a.calendarName}`.toLowerCase().includes(t.toLowerCase().split(' ')[0])))
    ?? null;
  if (!type && ev.cleaningType && !ev.test) {
    // A cleaning type used in GHL (e.g. "Classic Clean") that the Ops Hub doesn't know yet: add it to Settings → Job types.
    type = ev.cleaningType;
    const { error: e } = await db.from('company_settings').update({ job_types: [...types, type] }).eq('id', 1);
    if (!e) notes.push(`new cleaning type "${type}" added to Settings`);
  }
  type = type ?? ev.cleaningType ?? types[0];
  // Use the type's own checklist, or the default one until a checklist is made for it.
  const findChecklist = (t: string) => db.from('cleaning_checklists').select('id').eq('cleaning_type', t).eq('is_active', true).limit(1).maybeSingle();
  const checklist = (await findChecklist(type)).data ?? (await findChecklist(types[0])).data;
  const price = ev.price ?? (settings?.service_pricing ?? []).find((p: any) => p.service === type)?.price ?? null;
  const start = ghlTimeToUtc(a.start, a.timezone || tz);
  const end = a.end ? ghlTimeToUtc(a.end, a.timezone || tz) : new Date(new Date(start).getTime() + 3 * 36e5).toISOString();
  const { data: created, error } = await db.from('cleaning_jobs').insert({
    client_id: client.id, property_id: propertyId, checklist_id: checklist?.id ?? null, title: `${ev.contact.name} — ${type}`, cleaning_type: type,
    scheduled_start: start, scheduled_end: end, price, instructions: [ev.instructions, a.notes].filter(Boolean).join('\n') || null,
    status: 'scheduled', source: 'ghl', ghl_appointment_id: a.id, is_demo: ev.test,
  }).select('id').single();
  if (error) throw error;
  if (!opts.quiet) await db.rpc('notify_staff', {
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
    const { data: already } = await db.from('integration_events').select('id').eq('direction', 'out').eq('event', 'job_completed').eq('job_id', jobId).eq('status', 'ok').limit(1).maybeSingle();
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
  const { data } = await db.from('integration_events').select('id,external_id,attempts,payload').eq('direction', 'out').eq('event', 'job_completed').eq('status', 'failed').lt('attempts', 5).limit(20);
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

// ------------------------------------------------------------------ outbound (staff alerts → GHL workflow → text the office)
// Set GHL_ALERTS_WEBHOOK_URL to the URL of a GHL workflow with the "Inbound Webhook" trigger.
// The workflow texts the OFFICE ("Send Internal Notification" → SMS to staff), never the client: the payload carries no client phone/contact id.
export type GhlAlertEvent = 'on_my_way' | 'clock_in' | 'clock_out';
/** The webhook URL — if extra text was pasted around it in Vercel, use just the first https:// link. */
export const alertsWebhookUrl = () => clean(process.env.GHL_ALERTS_WEBHOOK_URL).match(/https:\/\/[^\s"'<>]+/)?.[0] ?? '';

/** Sends one event to the GHL alerts workflow. Never throws; failures are logged in Settings → Integrations. */
export async function sendGhlAlert(db: Db, event: GhlAlertEvent, attendanceOrJob: { jobId: string; employeeId: string; extra?: Record<string, any> }) {
  const url = alertsWebhookUrl();
  if (!url) return;
  try {
    const [{ data: job }, { data: emp }, { data: settings }, { data: owner }] = await Promise.all([
      db.from('cleaning_jobs').select('id,title,scheduled_start,client:clients(id,name),property:properties(address)').eq('id', attendanceOrJob.jobId).single(),
      db.from('users').select('full_name').eq('id', attendanceOrJob.employeeId).single(),
      db.from('company_settings').select('timezone,company_name').eq('id', 1).single(),
      db.from('users').select('full_name,email').eq('role_key', 'owner').eq('is_active', true).order('created_at').limit(1).maybeSingle(),
    ]);
    // GHL's Inbound Webhook must be linked ("Mapping Reference") to a contact. We give it the OFFICE contact
    // (GHL_ALERTS_CONTACT_EMAIL, else the owner's login email) so the workflow can only ever reach the office.
    const officeEmail = clean(process.env.GHL_ALERTS_CONTACT_EMAIL) || owner?.email || null;
    if (!job || !emp) return;
    const tz = settings?.timezone ?? 'America/Chicago';
    const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    const x = attendanceOrJob.extra ?? {};
    const where = (job as any).property?.address ?? '';
    const message =
      event === 'on_my_way' ? `${emp.full_name} is on the way to ${job.title}${x.eta_minutes ? ` (about ${x.eta_minutes} min)` : ''}. ${where}`
      : event === 'clock_in' ? `${emp.full_name} clocked in at ${job.title} at ${time(new Date().toISOString())}${x.location === 'verified' ? ' (GPS verified)' : x.location === 'outside_geofence' ? ` — ${Math.round(x.distance_m ?? 0)} m from the property` : x.location === 'unavailable' ? ' — no GPS' : ''}.`
      : `${emp.full_name} clocked out of ${job.title}${x.total_hours != null ? ` after ${Number(x.total_hours).toFixed(2)} h` : ''}.`;
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
    const body = {
      event, message,
      office_email: officeEmail, office_name: settings?.company_name ?? 'Heritage Housekeepers',
      cleaner_name: emp.full_name,
      job_title: job.title, job_start: time(job.scheduled_start), address: where,
      client_name: (job as any).client?.name ?? null, // no client phone or contact id: these alerts are for the office only
      link: site ? `${site}/admin/jobs/${job.id}` : null,
      ...x,
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GHL alert webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await db.from('integration_events').insert({ direction: 'out', event: `alert_${event}`, status: 'ok', message, job_id: job.id, client_id: (job as any).client?.id ?? null });
  } catch (e: any) {
    await db.from('integration_events').insert({ direction: 'out', event: `alert_${event}`, status: 'failed', message: String(e?.message ?? e).slice(0, 500), job_id: attendanceOrJob.jobId });
  }
}
