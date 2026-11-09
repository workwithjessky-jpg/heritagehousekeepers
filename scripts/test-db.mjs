// Database test suite: runs every migration in an embedded Postgres (PGlite) with a
// Supabase-compatible auth/storage stub, then exercises the six core workflows and the
// row-level-security boundaries as separate owner / manager / office / cleaner identities.
//
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();

const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { failed++; console.log(`  ✗ ${name}\n      ${err}`); };

async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    return (await tx.query(sql, params)).rows;
  });
}
const su = async (sql, params = []) => (await db.query(sql, params)).rows;

async function expectOk(name, fn) {
  try { const r = await fn(); ok(name); return r; } catch (e) { bad(name, e.message); }
}
async function expectFail(name, fn, pattern) {
  try { await fn(); bad(name, 'expected an error but the call succeeded'); }
  catch (e) {
    if (pattern && !pattern.test(e.message)) bad(name, `wrong error: ${e.message}`);
    else ok(`${name} (blocked: ${e.message.slice(0, 70)})`);
  }
}
function check(name, cond, detail = '') { cond ? ok(name) : bad(name, detail || 'assertion failed'); }

async function main() {
  console.log('Applying Supabase stub + migrations…');
  await db.exec(SUPABASE_STUB);
  const dir = join(root, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try { await db.exec(readFileSync(join(dir, f), 'utf8')); console.log(`  ✓ ${f}`); }
    catch (e) { console.log(`  ✗ ${f}: ${e.message}`); process.exit(1); }
  }
  const tables = await su(`select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  check(`schema has ${tables[0].n} tables (≥ 25 required)`, tables[0].n >= 25);
  const rls = await su(`select count(*)::int n from pg_tables where schemaname='public' and not rowsecurity`);
  check('row-level security enabled on every public table', rls[0].n === 0, `${rls[0].n} tables without RLS`);

  // ---------------------------------------------------------------- users
  console.log('\nRoles & provisioning');
  const ids = {};
  for (const [key, role, name] of [['owner', 'owner', 'Olivia Owner'], ['ops', 'ops_manager', 'Marcus Ops'],
    ['office', 'office_admin', 'Ana Office'], ['a', 'cleaner', 'Jane Smith'], ['b', 'cleaner', 'Rosa Diaz'], ['evil', 'cleaner', 'Mallory']]) {
    ids[key] = randomUUID();
    const meta = key === 'evil' ? { role: 'cleaner' } : { role };
    await su(`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ($1,$2,$3,$4)`,
      [ids[key], `${key}@test.local`, meta, { full_name: name, role: 'owner' /* user_metadata must be ignored */ }]);
  }
  const roles = await su(`select email, role_key from users order by email`);
  check('auth signup creates users + employee_profiles rows', roles.length === 6);
  check('role comes from app_metadata, not user-editable metadata', roles.find((r) => r.email === 'evil@test.local').role_key === 'cleaner');

  await expectOk('owner sets pay rate', () => as(ids.owner, `update employee_profiles set pay_rate = 20 where user_id = $1`, [ids.a]));
  await as(ids.owner, `update employee_profiles set pay_rate = 22, team = 'North' where user_id = $1`, [ids.b]);
  await expectFail('office admin cannot change pay rate', () => as(ids.office, `update employee_profiles set pay_rate = 99 where user_id = $1`, [ids.a]), /compensation/);
  await expectFail('cleaner cannot promote self to owner', () => as(ids.a, `update users set role_key = 'owner' where id = $1`, [ids.a]), /owner/);
  const othersSeen = await as(ids.a, `select count(*)::int n from users`);
  check('cleaner sees only own user row', othersSeen[0].n === 1, `saw ${othersSeen[0].n}`);
  await expectFail('cleaner cannot call internal notify()', () => as(ids.a, `select notify($1,'x','spam',null,null)`, [ids.b]), /permission denied/);

  // ---------------------------------------------------------------- Workflow 1
  console.log('\nWorkflow 1 — new cleaning assignment');
  const [client] = await as(ids.office, `insert into clients (name, email, phone) values ('Whitfield Family','w@example.com','555-0101') returning id`);
  const [prop] = await as(ids.office, `insert into properties (client_id, name, address, latitude, longitude, geofence_radius_m)
                                       values ($1,'Whitfield Residence','12 Oak Lane',40.7128,-74.0060,150) returning id`, [client.id]);
  await as(ids.ops, `insert into property_access_codes (property_id, lockbox_code) values ($1,'4321')`, [prop.id]);
  const [checklist] = await su(`select id from cleaning_checklists where cleaning_type = 'Standard Residential'`);
  const start = new Date(Date.now() - 5 * 60e3).toISOString();
  const end = new Date(Date.now() + 3 * 3600e3).toISOString();
  const [{ create_job_series: jobIds }] = await as(ids.office, `select create_job_series($1::jsonb, 1)`, [{
    property_id: prop.id, checklist_id: checklist.id, title: 'Whitfield — Standard Clean', cleaning_type: 'Standard Residential',
    scheduled_start: start, scheduled_end: end, price: 180, instructions: 'Use the side door.' }]);
  const job = jobIds[0];
  check('office admin creates job', !!job);
  const recs = await as(ids.ops, `select * from recommend_cleaners($1)`, [job]);
  check('recommend_cleaners ranks available cleaners', recs.length === 3, JSON.stringify(recs));
  await expectOk('ops manager assigns Jane as team lead', () => as(ids.ops, `select assign_employee($1,$2,true,false)`, [job, ids.a]));
  const n1 = await as(ids.a, `select title from notifications where type = 'job_assigned'`);
  check('Jane receives "New job assigned" notification', n1.length === 1);
  const seen = await as(ids.a, `select j.title, p.address, c.name from cleaning_jobs j join properties p on p.id=j.property_id join clients c on c.id=j.client_id`);
  check('Jane sees the job, property and client in her dashboard', seen.length === 1 && seen[0].address === '12 Oak Lane');
  const code = await as(ids.a, `select lockbox_code from property_access_codes`);
  check('Jane can see the lockbox code for her imminent job', code[0]?.lockbox_code === '4321');
  const notSeen = await as(ids.b, `select count(*)::int n from cleaning_jobs`);
  const noCode = await as(ids.b, `select count(*)::int n from property_access_codes`);
  check('Rosa (unassigned) cannot see the job or its entry codes', notSeen[0].n === 0 && noCode[0].n === 0);
  const team = await as(ids.a, `select full_name from job_team($1)`, [job]);
  check('job_team returns teammate names', team[0]?.full_name === 'Jane Smith');

  // conflict detection
  const [{ create_job_series: overlapIds }] = await as(ids.office, `select create_job_series($1::jsonb, 1)`, [{
    property_id: prop.id, title: 'Overlap test', cleaning_type: 'Deep Clean',
    scheduled_start: new Date(Date.now() + 3600e3).toISOString(), scheduled_end: new Date(Date.now() + 4 * 3600e3).toISOString() }]);
  await expectFail('overlapping assignment is prevented', () => as(ids.office, `select assign_employee($1,$2)`, [overlapIds[0], ids.a]), /conflict/i);
  await expectOk('supervisor can force-override with audit', () => as(ids.ops, `select assign_employee($1,$2,false,true)`, [overlapIds[0], ids.a]));
  await as(ids.ops, `select unassign_employee($1,$2)`, [overlapIds[0], ids.a]);
  // recurring series
  const [{ create_job_series: series }] = await as(ids.office, `select create_job_series($1::jsonb, 4)`, [{
    property_id: prop.id, title: 'Weekly upkeep', cleaning_type: 'Recurring Maintenance', recurrence_rule: 'weekly',
    scheduled_start: '2027-01-04T14:00:00Z', scheduled_end: '2027-01-04T16:00:00Z' }]);
  const gaps = await su(`select count(distinct recurrence_group_id)::int g, count(*)::int n, max(scheduled_start) - min(scheduled_start) span from cleaning_jobs where id = any($1)`, [series]);
  check('weekly recurring series creates 4 linked jobs 3 weeks apart', gaps[0].n === 4 && gaps[0].g === 1 && String(gaps[0].span?.days ?? gaps[0].span).startsWith('21'), JSON.stringify(gaps[0]));

  // ---------------------------------------------------------------- Workflow 2
  console.log('\nWorkflow 2 — GPS clock-in');
  await expectFail('clock-in requires location policy consent', () => as(ids.a, `select clock_in($1, 40.7130, -74.0062, 10)`, [job]), /location policy/);
  await as(ids.a, `select record_location_consent()`);
  await expectFail('clock-in without GPS requires an exception reason', () => as(ids.a, `select clock_in($1)`, [job]), /reason/);
  const [att] = await as(ids.a, `select * from clock_in($1, 40.7130, -74.0062, 10)`, [job]);
  check('attendance saved with GPS + timestamp', att && att.clock_in_latitude === 40.713 && !!att.clock_in_at);
  check(`geofence verified (${Math.round(att.clock_in_distance_m)} m from property)`, att.clock_in_location === 'verified');
  const gps = await as(ids.ops, `select event, within_geofence from gps_locations where attendance_id = $1`, [att.id]);
  check('location history row stored', gps.length === 1 && gps[0].within_geofence === true);
  const adminN = await as(ids.ops, `select title from notifications where type = 'clock_in'`);
  check('manager notified of clock-in', adminN.length === 1 && adminN[0].title.includes('Jane'));
  await expectFail('duplicate open clock-in prevented', () => as(ids.a, `select clock_in($1, 40.7130, -74.0062, 10)`, [job]), /already clocked in/);
  const status = await su(`select status from cleaning_jobs where id = $1`, [job]);
  check('job moves to In Progress', status[0].status === 'in_progress');

  // ---------------------------------------------------------------- Workflow 3
  console.log('\nWorkflow 3 — checklist, photos, clock-out, completion');
  await expectFail('cannot complete with open checklist/photos and no exception', () =>
    as(ids.a, `select clock_out($1, 40.7130, -74.0062, 10, 0)`, [att.id]), /incomplete/);
  const tasks = await as(ids.a, `select id, requires_photo from checklist_tasks where checklist_id = $1`, [checklist.id]);
  for (const t of tasks) {
    await as(ids.a, `select save_checklist_item($1,$2,true,null,$3)`, [job, t.id, t.requires_photo ? `${job}/task-${t.id}.jpg` : null]);
  }
  await expectOk('cleaner uploads storage object for her job', () => as(ids.a, `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${job}/before.jpg`]));
  await expectFail('cleaner cannot upload into another job folder', () => as(ids.b, `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${job}/x.jpg`]), /row-level security/);
  await as(ids.a, `insert into job_photos (job_id, employee_id, kind, storage_path) values ($1,$2,'before',$3), ($1,$2,'after',$4)`,
    [job, ids.a, `${job}/before.jpg`, `${job}/after.jpg`]);
  await expectFail('cleaner cannot register a photo stored under another job', () => as(ids.a, `insert into job_photos (job_id, employee_id, kind, storage_path) values ($1,$2,'after',$3)`, [job, ids.a, `${overlapIds[0]}/x.jpg`]), /row-level security/);
  const comp = await as(ids.a, `select job_completion_status($1) s`, [job]);
  check('completion status shows nothing outstanding', comp[0].s.required_open.length === 0 && comp[0].s.photos_missing.length === 0, JSON.stringify(comp[0].s));
  await su(`update attendance_records set clock_in_at = now() - interval '3 hours 10 minutes' where id = $1`, [att.id]); // simulate a 3h10m shift
  const [ts] = await as(ids.a, `select * from clock_out($1, 40.7129, -74.0061, 8, 10)`, [att.id]);
  check(`timesheet generated: ${ts?.total_hours} h, $${ts?.estimated_earnings}`, ts && Number(ts.total_hours) === 3 && Number(ts.estimated_earnings) === 60);
  const js = await su(`select status, completed_at from cleaning_jobs where id = $1`, [job]);
  check('job status → Completed', js[0].status === 'completed' && js[0].completed_at);
  const doneN = await as(ids.owner, `select count(*)::int n from notifications where type = 'job_completed'`);
  check('admin notified of completion', doneN[0].n === 1);

  // ---------------------------------------------------------------- Workflow 4
  console.log('\nWorkflow 4 — timesheet approval');
  const mine = await as(ids.a, `select id, status from timesheets`);
  check('employee reviews own draft timesheet', mine.length === 1 && mine[0].status === 'draft');
  const [{ submit_timesheets: sub }] = await as(ids.a, `select submit_timesheets($1::uuid[])`, [[ts.id]]);
  check('employee submits timesheet', sub === 1);
  await expectFail('office admin cannot approve', () => as(ids.office, `select review_timesheets($1::uuid[], 'approve')`, [[ts.id]]), /owner or an operations manager/);
  await expectOk('office admin prepares (under review)', () => as(ids.office, `select review_timesheets($1::uuid[], 'under_review')`, [[ts.id]]));
  await expectOk('manager edits entry with reason (audit trail)', () => as(ids.ops,
    `select manager_edit_timesheet($1, clock_in_at, clock_in_at + interval '8 hours 30 minutes', 30, 'Client confirmed extended deep clean') from timesheets where id = $1`, [ts.id]));
  const adj = await as(ids.ops, `select kind, old_values->>'total_hours' o, new_values->>'total_hours' n from timesheet_adjustments where timesheet_id = $1`, [ts.id]);
  check(`adjustment logged (${adj[0]?.o} h → ${adj[0]?.n} h)`, adj.length === 1 && Number(adj[0].n) === 8);
  await expectFail('cleaner cannot approve own timesheet', () => as(ids.a, `select review_timesheets($1::uuid[], 'approve')`, [[ts.id]]), /not allowed/);
  await expectFail('cleaner cannot write timesheets directly', () => as(ids.a, `update timesheets set total_hours = 40 where id = $1 returning id`, [ts.id]).then((r) => { if (!r.length) throw new Error('0 rows updated (RLS)'); }), /RLS|denied/);
  await expectOk('ops manager approves', () => as(ids.ops, `select review_timesheets($1::uuid[], 'approve', 'Looks good')`, [[ts.id]]));
  const apprN = await as(ids.a, `select count(*)::int n from notifications where type = 'timesheet_approved'`);
  check('employee notified of approval', apprN[0].n === 1);
  // missed punch correction
  await expectOk('cleaner requests missed-punch correction', () => as(ids.a,
    `select request_timesheet_correction(null, $1, now() - interval '30 hours', now() - interval '28 hours', 0, 'Phone died, forgot to clock in')`, [job]));
  const [corr] = await as(ids.ops, `select id from timesheet_adjustments where kind = 'missed_punch_request'`);
  await expectOk('manager approves correction → manual timesheet created', () => as(ids.ops, `select review_correction($1, true, 'Verified with client')`, [corr.id]));
  const manual = await as(ids.a, `select flags from timesheets where is_manual`);
  check('manual entry flagged for payroll review', manual[0]?.flags.includes('manual_adjustment'));

  // ---------------------------------------------------------------- Workflow 5
  console.log('\nWorkflow 5 — payroll');
  await expectFail('ops manager cannot run payroll', () => as(ids.ops, `select ensure_payroll_period(current_date)`), /not allowed/);
  const [period] = await as(ids.owner, `select * from ensure_payroll_period(current_date)`);
  check(`pay period created ${period.start_date.toISOString?.().slice(0, 10) ?? period.start_date} → pay date set`, !!period.pay_date);
  await as(ids.owner, `select generate_payroll($1)`, [period.id]);
  let [pr] = await as(ids.owner, `select * from payroll_records where employee_id = $1`, [ids.a]);
  check(`gross = 8 h × $20 = $${pr?.gross_pay}; net left blank (no deductions configured)`, Number(pr?.gross_pay) === 160 && pr.net_pay_estimate === null);
  check('manually-adjusted entry surfaced as a payroll discrepancy', pr.discrepancies.some((d) => d.includes('flagged')), JSON.stringify(pr.discrepancies));
  await as(ids.owner, `update company_settings set overtime_enabled = true, overtime_daily_threshold = 6`);
  await as(ids.owner, `update employee_profiles set deductions = '[{"name":"Uniform","type":"fixed","amount":15}]' where user_id = $1`, [ids.a]);
  await as(ids.owner, `select add_payroll_adjustment($1, 'bonus', 'Great feedback', 25)`, [pr.id]);
  [pr] = await as(ids.owner, `select * from payroll_records where employee_id = $1`, [ids.a]);
  check(`configurable OT: 6 reg + 2 OT ×1.5 → $${pr.regular_pay} + $${pr.overtime_pay} + $25 bonus = $${pr.gross_pay}`,
    Number(pr.regular_hours) === 6 && Number(pr.overtime_hours) === 2 && Number(pr.gross_pay) === 205);
  check(`configured deduction applied → net estimate $${pr.net_pay_estimate}`, Number(pr.net_pay_estimate) === 190);
  const otherPay = await as(ids.b, `select count(*)::int n from payroll_records`);
  const otherTs = await as(ids.b, `select count(*)::int n from timesheets`);
  check('Rosa cannot see Jane\'s payroll or timesheets', otherPay[0].n === 0 && otherTs[0].n === 0);
  const opsView = await as(ids.ops, `select count(*)::int n from payroll_records`);
  check('ops manager can view payroll estimates', opsView[0].n === 1);
  await expectFail('cannot mark paid before approval', () => as(ids.owner, `select mark_payroll_paid($1)`, [period.id]), /approved/);
  await expectOk('owner approves payroll', () => as(ids.owner, `select approve_payroll($1)`, [period.id]));
  await expectOk('owner marks paid after payment', () => as(ids.owner, `select mark_payroll_paid($1)`, [period.id]));
  const paid = await su(`select status from timesheets where id = $1`, [ts.id]);
  check('approved timesheets become Paid', paid[0].status === 'paid');
  await expectFail('paid timesheets are locked', () => as(ids.ops, `select manager_edit_timesheet($1, now()-interval '2h', now(), 0, 'x')`, [ts.id]), /Paid/);
  const payN = await as(ids.a, `select count(*)::int n from notifications where type in ('payroll_processed','payroll_paid')`);
  check('employee notified when payroll processed and paid', payN[0].n === 2);

  // ---------------------------------------------------------------- Workflow 6
  console.log('\nWorkflow 6 — time off');
  const [{ create_job_series: futureIds }] = await as(ids.office, `select create_job_series($1::jsonb, 1)`, [{
    property_id: prop.id, title: 'Future clean', cleaning_type: 'Deep Clean',
    scheduled_start: '2027-02-10T15:00:00Z', scheduled_end: '2027-02-10T18:00:00Z' }]);
  await as(ids.ops, `select assign_employee($1,$2)`, [futureIds[0], ids.b]);
  const [tor] = await as(ids.b, `select * from request_time_off('2027-02-09','2027-02-11','vacation','Family trip')`);
  const torN = await as(ids.ops, `select count(*)::int n from notifications where type = 'time_off_requested'`);
  check('manager notified of time-off request', torN[0].n === 1);
  const warn = await as(ids.ops, `select * from check_assignment_conflicts($1, '2027-02-10T19:00:00Z', '2027-02-10T20:00:00Z')`, [ids.b]);
  check('pending time off shows as a scheduling warning', warn.some((w) => w.code === 'time_off' && w.severity === 'warn'));
  const [{ review_time_off: affected }] = await as(ids.ops, `select review_time_off($1, true, 'Enjoy!')`, [tor.id]);
  check('approval flags the overlapping job for reassignment', affected === 1);
  const fj = await su(`select status from cleaning_jobs where id = $1`, [futureIds[0]]);
  check('job status → Needs Attention', fj[0].status === 'needs_attention');
  const torApproved = await as(ids.b, `select count(*)::int n from notifications where type = 'time_off_approved'`);
  check('employee notified of decision', torApproved[0].n === 1);
  const blk = await as(ids.ops, `select * from check_assignment_conflicts($1, '2027-02-10T19:00:00Z', '2027-02-10T20:00:00Z')`, [ids.b]);
  check('approved time off now blocks new assignments', blk.some((w) => w.code === 'time_off' && w.severity === 'block'));

  // ---------------------------------------------------------------- GPS exceptions & scheduled checks
  console.log('\nGeofence exceptions & automated checks');
  const [{ create_job_series: j2 }] = await as(ids.office, `select create_job_series($1::jsonb, 1)`, [{
    property_id: prop.id, title: 'Rosa job', cleaning_type: 'Standard Residential',
    scheduled_start: new Date(Date.now() - 40 * 60e3).toISOString(), scheduled_end: new Date(Date.now() + 60 * 60e3).toISOString() }]);
  await as(ids.ops, `select assign_employee($1,$2)`, [j2[0], ids.b]);
  await su(`select run_attendance_checks()`);
  const missed = await as(ids.b, `select count(*)::int n from notifications where type = 'missed_clock_in'`);
  check('missed clock-in detected and cleaner alerted', missed[0].n === 1);
  await as(ids.b, `select record_location_consent()`);
  const [far] = await as(ids.b, `select * from clock_in($1, 40.7580, -73.9855, 15)`, [j2[0]]);
  check(`clock-in ${Math.round(far.clock_in_distance_m)} m away flagged outside geofence`, far.clock_in_location === 'outside_geofence' && far.flags.includes('outside_geofence'));
  const geoN = await as(ids.owner, `select count(*)::int n from notifications where type = 'attendance_exception'`);
  check('owner alerted to geofence exception', geoN[0].n === 1);
  const officeGeo = await as(ids.office, `select count(*)::int n from notifications where type = 'attendance_exception'`);
  check('office admin sees attendance records (review) but geofence alerts go to supervisors', officeGeo[0].n === 0);

  // audit trail
  const audits = await as(ids.owner, `select count(*)::int n from audit_logs`);
  check(`audit log populated (${audits[0].n} entries)`, audits[0].n > 10);
  const officeAudit = await as(ids.office, `select count(*)::int n from audit_logs`);
  check('only the owner can read audit logs', officeAudit[0].n === 0);
  const outbox = await su(`select count(*)::int n from notification_deliveries`);
  check('email outbox stays empty while email is disabled in settings', outbox[0].n === 0);
  await su(`update company_settings set notification_prefs = jsonb_set(notification_prefs, '{email_enabled}', 'true')`);
  await as(ids.owner, `insert into announcements (title, body) values ('Holiday hours', 'Office closed Friday.')`);
  const outbox2 = await su(`select count(*)::int n from notification_deliveries where channel = 'email'`);
  check(`announcement queued ${outbox2[0].n} emails once email is enabled`, outbox2[0].n === 6);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
