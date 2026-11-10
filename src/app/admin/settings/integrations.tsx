import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ghlConfigured, webhookSecret } from '@/lib/ghl';
import { listGhlCalendars, type GhlCalendar } from '@/lib/ghl-import';
import { createAdminClient } from '@/lib/supabase/server';
import { ActionForm, SubmitButton } from '@/components/forms';
import { importFromGhl } from '../_actions/settings';
import { fmtDateTime, titleCase } from '@/lib/format';
import { Badge, Table, Th, Td, Empty } from '@/components/ui';

/** Settings → Integrations (owner only): GoHighLevel setup details and the sync log. */
export async function IntegrationsTab({ tz }: { tz: string }) {
  const supabase = await createClient();
  const { data: events } = await supabase.from('integration_events').select('*').order('created_at', { ascending: false }).limit(50);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '') || 'https://YOUR-APP.vercel.app';
  const inbound = ghlConfigured.inbound();
  const outbound = ghlConfigured.outbound();
  const url = `${site}/api/integrations/ghl?key=${webhookSecret() || 'SET-GHL_WEBHOOK_SECRET'}`;
  const tag = process.env.GHL_COMPLETED_TAG || 'cleaning-completed';

  return (
    <div className="space-y-6 text-sm text-stone-700">
      <div>
        <h3 className="text-base font-semibold text-ink">GoHighLevel</h3>
        <p className="mt-1">Bookings and contacts added in GHL appear here automatically; completed jobs tag the contact back in GHL.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={inbound ? 'green' : 'amber'}>GHL → Ops Hub: {inbound ? 'ready' : 'needs GHL_WEBHOOK_SECRET'}</Badge>
          <Badge tone={outbound ? 'green' : 'amber'}>Ops Hub → GHL: {outbound ? 'ready' : 'needs GHL_PRIVATE_TOKEN'}</Badge>
        </div>
      </div>

      {inbound && (
        <div>
          <p className="font-medium text-ink">Webhook URL (keep private — anyone with it can create bookings)</p>
          <code className="mt-1 block break-all rounded-xl bg-stone-100 px-3 py-2 text-xs">{url}</code>
        </div>
      )}

      <ImportBox enabled={outbound} />

      <ol className="list-decimal space-y-2 pl-5">
        <li>In GHL go to <b>Automation → Workflows → Create workflow</b>. Add the triggers <b>Customer Booked Appointment</b> and <b>Appointment Status</b> (filter to your cleaning calendar), plus <b>Contact Tag</b> (e.g. tag <code>client</code>) if you also want contacts without a booking.</li>
        <li>Add the action <b>Webhook</b> → Method <b>POST</b> → URL: the webhook URL above.</li>
        <li>Optional <b>Custom Data</b> on the webhook: <code>cleaning_type</code> (e.g. Deep Clean), <code>price</code>, <code>instructions</code>. Otherwise the type is guessed from the calendar name and the price comes from Settings → Services.</li>
        <li>Make sure each contact has the <b>street address, city, state and postal code</b> filled in — that becomes the property and its GPS geofence.</li>
        <li>For the return trip, create a workflow with trigger <b>Contact Tag Added → <code>{tag}</code></b> to send review requests or thank-you texts.</li>
      </ol>

      <div>
        <p className="mb-2 font-medium text-ink">Recent sync activity</p>
        {(events ?? []).length === 0 ? <Empty title="Nothing received yet">Run your GHL workflow once (or book a test appointment) and it will show up here.</Empty> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Direction</Th><Th>Event</Th><Th>Result</Th><Th>Record</Th></tr></thead>
            <tbody>
              {(events as any[]).map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(e.created_at, tz)}</Td>
                  <Td>{e.direction === 'in' ? 'GHL → Hub' : 'Hub → GHL'}</Td>
                  <Td>{titleCase(e.event)}</Td>
                  <Td><Badge tone={e.status === 'ok' ? 'green' : e.status === 'failed' ? 'red' : 'gray'}>{e.status}</Badge><div className="mt-1 max-w-sm text-xs text-stone-500">{e.message}</div></Td>
                  <Td className="text-xs">
                    {e.job_id && <Link className="text-sage-700 underline" href={`/admin/jobs/${e.job_id}`}>Job</Link>}{' '}
                    {e.client_id && <Link className="text-sage-700 underline" href={`/admin/clients/${e.client_id}`}>Client</Link>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** "Import from GHL": pick calendars, bring in the appointments already booked there. */
async function ImportBox({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
        <p className="font-medium text-ink">Import existing GHL bookings</p>
        <p className="mt-1">Needs a GHL Private Integration token saved in Vercel as <code>GHL_PRIVATE_TOKEN</code> (scopes: View Calendars, View Calendar Events, View Contacts, View Custom Fields, Edit Contacts), then a redeploy.</p>
      </div>
    );
  }
  let calendars: GhlCalendar[] = [];
  let error: string | null = null;
  try { calendars = await listGhlCalendars(createAdminClient()); } catch (e: any) { error = String(e.message); }
  return (
    <div className="rounded-2xl border border-sage-200 bg-sage-50/40 p-4">
      <p className="font-medium text-ink">Import existing GHL bookings</p>
      <p className="mt-1">Brings appointments already booked in GHL into the schedule. Safe to run again — nothing is duplicated, cancelled bookings are skipped.</p>
      {error ? <p className="mt-2 text-red-700">Could not read your GHL calendars: {error}</p> : (
        <ActionForm action={importFromGhl} className="mt-3 space-y-3">
          <div className="space-y-1.5">
            {calendars.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" name="calendar" value={c.id} defaultChecked={c.suggested && c.active} className="size-4 accent-sage-700" />
                <span>{c.name}</span>{!c.active && <span className="text-xs text-stone-500">(draft)</span>}
              </label>
            ))}
            {calendars.length === 0 && <p className="text-stone-500">No calendars found in this GHL account.</p>}
          </div>
          <label className="flex items-center gap-2">Bookings in the next
            <select name="days" defaultValue="60" className="rounded-lg border border-stone-300 bg-white px-2 py-1">
              {[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <SubmitButton pendingText="Importing… this can take a minute">Import from GHL</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
