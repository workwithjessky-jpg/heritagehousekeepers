import { NextResponse, type NextRequest } from 'next/server';
import { zipSync } from 'fflate';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser, getSettings, isStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/export/job-photos/:jobId — every photo of one job (before/after/issue/checklist) as a .zip. Staff only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me || !isStaff(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const supabase = await createClient();
  const { timezone } = await getSettings();

  const { data: job } = await supabase.from('cleaning_jobs').select('id,title,scheduled_start,client:clients(name)').eq('id', id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const [{ data: photos }, { data: checklist }, { data: issues }] = await Promise.all([
    supabase.from('job_photos').select('storage_path,kind,created_at').eq('job_id', id).order('created_at'),
    supabase.from('checklist_submissions').select('photo_path,completed_at').eq('job_id', id).not('photo_path', 'is', null),
    supabase.from('job_issues').select('photo_path,created_at').eq('job_id', id).not('photo_path', 'is', null),
  ]);
  const list = new Map<string, string>(); // storage path → kind
  for (const p of (photos ?? []) as any[]) list.set(p.storage_path, p.kind);
  for (const p of (checklist ?? []) as any[]) if (!list.has(p.photo_path)) list.set(p.photo_path, 'checklist');
  for (const p of (issues ?? []) as any[]) if (!list.has(p.photo_path)) list.set(p.photo_path, 'issue');
  if (!list.size) return NextResponse.json({ error: 'This job has no photos yet' }, { status: 404 });

  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  await Promise.all([...list].map(async ([path, kind]) => {
    const { data } = await supabase.storage.from('job-photos').download(path);
    if (!data) return;
    const ext = (path.split('.').pop() || 'jpg').toLowerCase().slice(0, 5);
    const n = (counts[kind] = (counts[kind] ?? 0) + 1);
    files[`${kind}/${kind}-${String(n).padStart(2, '0')}.${ext}`] = new Uint8Array(await data.arrayBuffer());
  }));
  // photos are already compressed — store them without re-compressing (faster, same size)
  const zip = zipSync(files, { level: 0 });

  const day = new Date(job.scheduled_start).toLocaleDateString('en-CA', { timeZone: timezone });
  const name = `${day} ${job.title}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim();
  return new NextResponse(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name || 'job'} photos.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
