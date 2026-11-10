import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Detects missed clock-ins and forgotten clock-outs and alerts cleaners + management.
// Runs every 5 min inside Supabase (pg_cron, migration 8); this route is a manual/backup trigger. Requires "Authorization: Bearer $CRON_SECRET".
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc('run_attendance_checks');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
