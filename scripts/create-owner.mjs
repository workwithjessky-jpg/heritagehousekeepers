// Creates the first Owner login (run once after migrations).
//   npm run create-owner -- --email you@company.com --name "Your Name" [--password "at-least-10-chars"]
// Without --password an invitation email is sent instead (Supabase email must be configured).
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const email = arg('email')?.toLowerCase();
const name = arg('name');
const password = arg('password');
if (!email || !name) { console.error('Usage: npm run create-owner -- --email you@company.com --name "Your Name" [--password ...]'); process.exit(1); }
if (password && password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
let id;
if (password) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'owner' }, user_metadata: { full_name: name } });
  if (error) { console.error(error.message); process.exit(1); }
  id = data.user.id;
} else {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo: `${site}/auth/confirm?next=/auth/set-password` });
  if (error) { console.error(error.message); process.exit(1); }
  id = data.user.id;
  await db.auth.admin.updateUserById(id, { app_metadata: { role: 'owner' } });
}
const { error: e2 } = await db.from('users').update({ role_key: 'owner' }).eq('id', id);
if (e2) { console.error('Login created but role update failed:', e2.message); process.exit(1); }
await db.from('employee_profiles').update({ job_title: 'Owner', employment_status: 'active', employment_type: 'salaried' }).eq('user_id', id);
console.log(`Owner ready: ${email}${password ? '' : ' (invitation email sent)'}`);
