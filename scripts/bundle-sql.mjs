// Concatenates all migrations into supabase/setup.sql — paste it into the Supabase SQL editor
// if you are not using the Supabase CLI (`supabase db push`).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'supabase/migrations';
const parts = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => `-- >>>>>>>>>> ${f}\n${readFileSync(join(dir, f), 'utf8')}`);
writeFileSync('supabase/setup.sql', `-- Heritage Housekeepers | Operations Hub — full database setup (generated; do not edit)\n-- Run once on a NEW Supabase project.\n\n${parts.join('\n\n')}\n`);
console.log(`Wrote supabase/setup.sql (${parts.length} migrations)`);
