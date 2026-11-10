// Verifies every PostgREST embed hint (users!<constraint>) used in the app names a real FK.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const db = new PGlite();
const stub = readFileSync('scripts/test-db.mjs', 'utf8').match(/SUPABASE_STUB = `([\s\S]*?)`;/)[1];
await db.exec(stub);
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(join('supabase/migrations', f), 'utf8'));
const rows = (await db.query(`select conname, conrelid = confrelid as self from pg_constraint where contype='f'`)).rows;
const fks = new Set(rows.map((r) => r.conname));
// PostgREST can't resolve a self-referencing FK by constraint name; it needs the column (e.g. table!parent_id).
const selfFks = new Set(rows.filter((r) => r.self).map((r) => r.conname));
const walk = (d) => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
let bad = 0, n = 0;
for (const file of walk('src').filter((f) => /\.tsx?$/.test(f))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/!(\w+_fkey)/g)) { n++; if (!fks.has(m[1])) { bad++; console.log('MISSING', m[1], 'in', file); }
    else if (selfFks.has(m[1])) { bad++; console.log('SELF-REFERENCE (use the column name instead)', m[1], 'in', file); } }
}
console.log(`${n} FK hints checked, ${bad} missing`);
process.exit(bad ? 1 : 0);
