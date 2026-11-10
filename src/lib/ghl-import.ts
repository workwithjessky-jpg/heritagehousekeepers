import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { privateToken, parseGhlPayload, handleGhlEvent } from './ghl';

/**
 * One-click import of appointments that already exist in GHL calendars (bookings made before the
 * webhook was set up). Each appointment goes through the same handler as the live webhook, so
 * clients, properties and jobs are matched by GHL id and never duplicated — safe to run again.
 * Needs GHL_PRIVATE_TOKEN with: calendars.readonly, calendars/events.readonly, contacts.readonly,
 * locations/customFields.readonly.
 */
type Db = SupabaseClient;
const API = 'https://services.leadconnectorhq.com';
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^["']|["']$/g, '').trim();

async function ghlGet(path: string, versions: string[]) {
  let last = '';
  for (const v of versions) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${privateToken()}`, Version: v, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000), cache: 'no-store',
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text || '{}');
    last = `GHL ${res.status} on ${path.split('?')[0]}: ${text.slice(0, 200)}`;
    if (res.status === 401 || res.status === 403) break; // token / scope problem: another version won't help
  }
  throw new Error(last);
}
const CAL_VERSIONS = ['2021-04-15', 'v3'];
const CONTACT_VERSIONS = ['2021-07-28', 'v3'];

/** Location (sub-account) id: GHL_LOCATION_ID, else the one GHL sent with its latest webhook. */
export async function ghlLocationId(db: Db) {
  const env = clean(process.env.GHL_LOCATION_ID);
  if (env) return env;
  const { data } = await db.from('integration_events').select('payload').eq('direction', 'in')
    .not('payload->location', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const id = (data as any)?.payload?.location?.id;
  return typeof id === 'string' && id ? id : null;
}

export type GhlCalendar = { id: string; name: string; active: boolean; suggested: boolean };

export async function listGhlCalendars(db: Db): Promise<GhlCalendar[]> {
  const loc = await ghlLocationId(db);
  if (!loc) throw new Error('GHL location not known yet — send one booking through the GHL webhook first, or set GHL_LOCATION_ID');
  const j = await ghlGet(`/calendars/?locationId=${encodeURIComponent(loc)}`, CAL_VERSIONS);
  return ((j.calendars ?? []) as any[]).map((c) => ({
    id: String(c.id), name: String(c.name ?? 'Calendar'), active: c.isActive !== false,
    suggested: /clean|maid|house|residential|deep|move/i.test(String(c.name ?? '')) && !/interview|hiring|applicant|call|consult/i.test(String(c.name ?? '')),
  }));
}

export type ImportResult = { calendars: number; appointments: number; jobsCreated: number; updated: number; skipped: number; problems: string[] };

export async function importGhlAppointments(db: Db, calendarIds: string[], days = 60): Promise<ImportResult> {
  const out: ImportResult = { calendars: calendarIds.length, appointments: 0, jobsCreated: 0, updated: 0, skipped: 0, problems: [] };
  const loc = await ghlLocationId(db);
  if (!loc) throw new Error('GHL location not known yet');
  const calendars = new Map((await listGhlCalendars(db)).map((c) => [c.id, c.name]));

  // custom field id → name, so contact fields like "Cleaning Type" map the same way as webhook payloads
  const fieldNames = new Map<string, string>();
  try {
    const f = await ghlGet(`/locations/${encodeURIComponent(loc)}/customFields`, CONTACT_VERSIONS);
    for (const cf of (f.customFields ?? []) as any[]) fieldNames.set(String(cf.id), String(cf.name));
  } catch (e: any) { out.problems.push(`Custom fields not read (${String(e.message).slice(0, 120)}) — cleaning type will come from the calendar name`); }

  const contacts = new Map<string, any>();
  const getContact = async (id: string) => {
    if (!contacts.has(id)) contacts.set(id, (await ghlGet(`/contacts/${encodeURIComponent(id)}`, CONTACT_VERSIONS)).contact ?? null);
    return contacts.get(id);
  };

  const start = Date.now() - 864e5; // include today's earlier appointments
  const end = Date.now() + days * 864e5;
  for (const calId of calendarIds) {
    let events: any[] = [];
    try {
      const j = await ghlGet(`/calendars/events?locationId=${encodeURIComponent(loc)}&calendarId=${encodeURIComponent(calId)}&startTime=${start}&endTime=${end}`, CAL_VERSIONS);
      events = (j.events ?? []).filter((e: any) => !e.deleted);
    } catch (e: any) { out.problems.push(`${calendars.get(calId) ?? calId}: ${String(e.message).slice(0, 200)}`); continue; }

    for (const ev of events) {
      out.appointments++;
      const status = String(ev.appointmentStatus ?? ev.status ?? 'booked').toLowerCase();
      if (['cancelled', 'canceled', 'invalid', 'noshow', 'no_show'].includes(status)) { out.skipped++; continue; }
      if (!ev.contactId) { out.skipped++; out.problems.push(`"${ev.title ?? 'Appointment'}" has no contact`); continue; }
      try {
        const c = await getContact(String(ev.contactId));
        if (!c) { out.skipped++; continue; }
        const custom: Record<string, any> = {};
        for (const f of (c.customFields ?? c.customField ?? []) as any[]) {
          const name = fieldNames.get(String(f.id)); if (name) custom[name] = f.value ?? f.field_value;
        }
        const body = {
          ...custom,
          contact_id: c.id, first_name: c.firstName, last_name: c.lastName, full_name: c.name ?? c.contactName,
          email: c.email, phone: c.phone, address1: c.address1, city: c.city, state: c.state, postal_code: c.postalCode, tags: c.tags ?? [],
          calendar: {
            appointmentId: ev.id, startTime: ev.startTime, endTime: ev.endTime, status, title: ev.title,
            calendarName: calendars.get(calId) ?? '', notes: ev.notes ?? null, selectedTimezone: ev.timezone ?? null,
            // never the event's address: in GHL that is the business location, not the client's home
            address: null,
          },
        };
        const r = await handleGhlEvent(db, parseGhlPayload(body), { quiet: true }); // one summary alert instead of one per job
        if (/job created/.test(r.message)) out.jobsCreated++;
        else if (r.status === 'ok') out.updated++;
        else { out.skipped++; out.problems.push(`${c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Contact'}: ${r.message}`); }
      } catch (e: any) {
        out.skipped++; out.problems.push(`${ev.title ?? ev.id}: ${String(e.message).slice(0, 160)}`);
      }
    }
  }
  if (out.jobsCreated) {
    await db.rpc('notify_staff', {
      p_event: 'schedule_change', p_type: 'ghl_booking', p_title: `${out.jobsCreated} booking(s) imported from GoHighLevel`,
      p_body: 'They need cleaners assigned.', p_link: '/admin/schedule?view=list&filter=unassigned', p_roles: ['owner', 'ops_manager', 'office_admin'],
    });
  }
  await db.from('integration_events').insert({
    direction: 'in', event: 'import', status: out.problems.length ? 'ignored' : 'ok',
    message: `Imported ${out.jobsCreated} new job(s) from ${out.appointments} appointment(s); ${out.updated} already in the hub, ${out.skipped} skipped`.slice(0, 500),
    payload: { calendars: calendarIds, days, problems: out.problems.slice(0, 50) },
  });
  return out;
}
