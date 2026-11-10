import Link from 'next/link';
import { Camera, Download } from 'lucide-react';
import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rangeUtc } from '@/lib/queries';
import { todayInTz, addDays, fmtDate, fmtTime, titleCase } from '@/lib/format';
import { Card, PageHeader, Select, Input, Field, Badge, Empty, buttonClass } from '@/components/ui';

export const metadata = { title: 'Photos' };

const KIND_TONE: Record<string, 'gray' | 'green' | 'red' | 'blue'> = { before: 'gray', after: 'green', issue: 'red', checklist: 'blue' };

/** Every job photo, grouped by job, filterable by date, client, cleaner and photo type. */
export default async function PhotosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(STAFF);
  const sp = await searchParams;
  const { timezone: tz } = await getSettings();
  const today = todayInTz(tz);
  const from = sp.from || addDays(today, -13);
  const to = sp.to || today;
  const r = rangeUtc(from, addDays(to, 1), tz);
  const supabase = await createClient();

  const [{ data: jobs }, { data: clients }, { data: cleaners }] = await Promise.all([
    (() => {
      let q = supabase.from('cleaning_jobs')
        .select('id,title,scheduled_start,status,client:clients(id,name),property:properties(address),' +
          'job_photos(id,storage_path,kind,caption,created_at,employee_id,user:users!job_photos_employee_id_fkey(full_name)),' +
          'checklist_submissions(photo_path,completed_at,employee_id)')
        .gte('scheduled_start', r.from).lt('scheduled_start', r.to).order('scheduled_start', { ascending: false }).limit(200);
      if (sp.client) q = q.eq('client_id', sp.client);
      return q;
    })(),
    supabase.from('clients').select('id,name').order('name'),
    supabase.from('users').select('id,full_name').eq('role_key', 'cleaner').order('full_name'),
  ]);

  type Ph = { path: string; kind: string; caption: string | null; at: string; by: string | null; byId: string | null };
  const groups = ((jobs ?? []) as any[]).map((j) => {
    let list: Ph[] = [
      ...(j.job_photos ?? []).map((p: any) => ({ path: p.storage_path, kind: p.kind, caption: p.caption, at: p.created_at, by: p.user?.full_name ?? null, byId: p.employee_id })),
      ...(j.checklist_submissions ?? []).filter((c: any) => c.photo_path && !(j.job_photos ?? []).some((p: any) => p.storage_path === c.photo_path))
        .map((c: any) => ({ path: c.photo_path, kind: 'checklist', caption: null, at: c.completed_at, by: null, byId: c.employee_id })),
    ];
    if (sp.kind) list = list.filter((p) => p.kind === sp.kind);
    if (sp.cleaner) list = list.filter((p) => p.byId === sp.cleaner);
    return { job: j, photos: list.sort((a, b) => String(a.at).localeCompare(String(b.at))) };
  }).filter((g) => g.photos.length);

  const paths = groups.flatMap((g) => g.photos.map((p) => p.path)).slice(0, 600);
  const signed = paths.length ? (await supabase.storage.from('job-photos').createSignedUrls(paths, 3600)).data ?? [] : [];
  const url = new Map(signed.map((x: any) => [x.path, x.signedUrl as string]));
  const total = groups.reduce((n, g) => n + g.photos.length, 0);

  return (
    <>
      <PageHeader title="Photos" subtitle="Before, after, checklist and issue photos from every job" />

      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-3" action="/admin/photos">
          <Field label="From"><Input type="date" name="from" defaultValue={from} className="w-40" /></Field>
          <Field label="To"><Input type="date" name="to" defaultValue={to} className="w-40" /></Field>
          <Field label="Client">
            <Select name="client" defaultValue={sp.client ?? ''} className="w-48">
              <option value="">All clients</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Cleaner">
            <Select name="cleaner" defaultValue={sp.cleaner ?? ''} className="w-48">
              <option value="">All cleaners</option>
              {(cleaners ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select name="kind" defaultValue={sp.kind ?? ''} className="w-36">
              <option value="">All types</option>
              {['before', 'after', 'checklist', 'issue'].map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
            </Select>
          </Field>
          <button className={buttonClass('secondary', 'md')}>Apply</button>
          {(sp.from || sp.to || sp.client || sp.cleaner || sp.kind) && <Link href="/admin/photos" className="pb-2 text-sm text-stone-500 hover:underline">Clear</Link>}
        </form>
        <p className="mt-3 text-xs text-stone-500">{total} photo{total === 1 ? '' : 's'} from {groups.length} job{groups.length === 1 ? '' : 's'}</p>
      </Card>

      {groups.length === 0 ? (
        <Card><Empty title="No photos in this range" icon={<Camera className="size-5" />}>Photos appear here as soon as cleaners upload them.</Empty></Card>
      ) : (
        <div className="space-y-4">
          {groups.map(({ job, photos }) => (
            <Card key={job.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/admin/jobs/${job.id}`} className="font-medium text-ink hover:text-sage-700">{job.title}</Link>
                  <div className="text-xs text-stone-500">
                    {fmtDate(job.scheduled_start, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {fmtTime(job.scheduled_start, tz)}
                    {job.property?.address ? ` · ${job.property.address}` : ''}
                  </div>
                </div>
                <a href={`/api/export/job-photos/${job.id}`} className={buttonClass('secondary', 'sm')}>
                  <Download className="size-4" /> Download all ({photos.length})
                </a>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                {photos.map((p) => (
                  <a key={p.path} href={url.get(p.path)} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-lg bg-stone-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url.get(p.path) && <img src={url.get(p.path)} alt={p.caption ?? p.kind} loading="lazy" className="aspect-square w-full object-cover" />}
                    <span className="absolute top-1 left-1"><Badge tone={KIND_TONE[p.kind] ?? 'gray'}>{titleCase(p.kind)}</Badge></span>
                    <span className="absolute right-0 bottom-0 left-0 truncate bg-gradient-to-t from-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      {fmtTime(p.at, tz)}{p.by ? ` · ${p.by}` : ''}
                    </span>
                  </a>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
