// DEMO DATA — for testing only. Every record is flagged is_demo = true (shown with a purple
// "DEMO" tag in the app) and demo logins use the non-routable @heritage-demo.test domain.
//   npm run seed:demo            create demo cleaners, clients, properties and this week's jobs
//   npm run seed:demo -- --clear remove all demo records and demo logins
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const DOMAIN = '@heritage-demo.test';
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

async function clear() {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const demoUsers = (list?.users ?? []).filter((u) => u.email?.endsWith(DOMAIN));
  const ids = demoUsers.map((u) => u.id);
  const { data: jobs } = await db.from('cleaning_jobs').select('id').eq('is_demo', true);
  const jobIds = (jobs ?? []).map((j) => j.id);
  if (jobIds.length) {
    await db.from('timesheets').delete().in('job_id', jobIds);
    await db.from('attendance_records').delete().in('job_id', jobIds);
    await db.from('cleaning_jobs').delete().in('id', jobIds);
  }
  if (ids.length) {
    await db.from('timesheets').delete().in('employee_id', ids);
    await db.from('payroll_records').delete().in('employee_id', ids);
  }
  await db.from('clients').delete().eq('is_demo', true);
  for (const id of ids) await db.auth.admin.deleteUser(id);
  console.log(`Removed ${jobIds.length} demo jobs and ${ids.length} demo logins.`);
}

async function seed() {
  const { data: s } = await db.from('company_settings').select('timezone').eq('id', 1).single();
  const cleaners = [];
  for (const [i, name, rate, team] of [[1, 'Demo – Jane Smith', 20, 'North'], [2, 'Demo – Rosa Diaz', 21.5, 'North'], [3, 'Demo – Ama Owusu', 19, 'South']]) {
    const email = `cleaner${i}${DOMAIN}`;
    const password = randomBytes(9).toString('base64url');
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'cleaner' }, user_metadata: { full_name: name } });
    if (error) { console.log(`skip ${email}: ${error.message}`); continue; }
    await db.from('employee_profiles').update({ pay_rate: rate, team, employment_status: 'active', hire_date: '2025-03-01' }).eq('user_id', data.user.id);
    cleaners.push({ id: data.user.id, email, password, name });
  }

  const clients = [
    { name: 'Demo – Whitfield Family', email: 'whitfield@heritage-demo.test', phone: '555-0101', props: [['Whitfield Residence', '1600 Pennsylvania Ave NW, Washington, DC 20500', 38.8977, -77.0365]] },
    { name: 'Demo – Okafor Household', email: 'okafor@heritage-demo.test', phone: '555-0102', props: [['Okafor Townhouse', '700 Pennsylvania Ave NW, Washington, DC 20408', 38.8928, -77.0230], ['Okafor Rental Unit', '1000 Jefferson Dr SW, Washington, DC 20560', 38.8887, -77.0260]] },
    { name: 'Demo – Martin & Lee', email: 'martinlee@heritage-demo.test', phone: '555-0103', props: [['Martin-Lee Condo', '2 15th St NW, Washington, DC 20024', 38.8895, -77.0353]] },
  ];
  const { data: checklist } = await db.from('cleaning_checklists').select('id,cleaning_type');
  const cl = (t) => checklist?.find((c) => c.cleaning_type === t)?.id ?? null;
  const props = [];
  for (const c of clients) {
    const row = must(await db.from('clients').insert({ name: c.name, email: c.email, phone: c.phone, status: 'active', is_demo: true, notes: 'DEMO RECORD' }).select('id').single());
    for (const [name, address, lat, lng] of c.props) {
      props.push(must(await db.from('properties').insert({ client_id: row.id, name, address, latitude: lat, longitude: lng, bedrooms: 3, bathrooms: 2, square_feet: 1800, is_demo: true, access_instructions: 'DEMO: use side door' }).select('id,client_id,name').single()));
    }
  }

  // jobs across this week at 9am / 1pm company time (approximate using UTC offset of now)
  const tz = s?.timezone ?? 'America/New_York';
  const offsetH = Math.round((new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(new Date().toLocaleString('en-US', { timeZone: 'UTC' })).getTime()) / 36e5);
  const at = (dayOffset, hour) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(hour - offsetH, 0, 0, 0); return d.toISOString(); };
  const types = ['Standard Residential', 'Deep Clean', 'Recurring Maintenance'];
  let n = 0;
  for (let day = -2; day <= 5; day++) {
    for (const [slot, hour] of [[0, 9], [1, 13]]) {
      const p = props[(day + 2 + slot) % props.length];
      const type = types[(day + slot + 3) % types.length];
      const job = must(await db.from('cleaning_jobs').insert({
        client_id: p.client_id, property_id: p.id, checklist_id: cl(type), title: `${p.name} — ${type}`, cleaning_type: type,
        scheduled_start: at(day, hour), scheduled_end: at(day, hour + 3), price: type === 'Deep Clean' ? 280 : 165, is_demo: true,
        status: 'scheduled', instructions: 'DEMO JOB — for testing the workflow',
      }).select('id').single());
      const who = cleaners[(day + 2 + slot) % Math.max(cleaners.length, 1)];
      if (who && !(day === 4 && slot === 1)) { // leave one job unassigned to show dispatch
        await db.from('job_assignments').insert({ job_id: job.id, employee_id: who.id, is_team_lead: true });
        await db.from('cleaning_jobs').update({ status: 'assigned' }).eq('id', job.id);
      }
      n++;
    }
  }
  console.log(`Created ${clients.length} demo clients, ${props.length} properties, ${n} jobs.`);
  if (cleaners.length) {
    console.log('\nDemo cleaner logins (testing only — delete with --clear):');
    cleaners.forEach((c) => console.log(`  ${c.email}  /  ${c.password}`));
  }
}

(process.argv.includes('--clear') ? clear() : seed()).catch((e) => { console.error(e.message); process.exit(1); });
