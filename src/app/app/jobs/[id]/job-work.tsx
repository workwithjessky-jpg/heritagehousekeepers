'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, LoaderCircle, Check, ImagePlus } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase/client';
import { cx, Badge, Input } from '@/components/ui';
import { saveChecklistItem, addJobPhoto } from '../../actions';

/** Downscale photos on the phone before upload (saves data + storage). Falls back to the original file. */
async function compress(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  try {
    if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type)) throw new Error('skip');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.82));
    return { blob, ext: 'jpg', type: 'image/jpeg' };
  } catch {
    return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), type: file.type || 'image/jpeg' };
  }
}

export async function uploadJobPhoto(jobId: string, file: File): Promise<string> {
  const { blob, ext, type } = await compress(file);
  const path = `${jobId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await getBrowserClient().storage.from('job-photos').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export function PhotoButton({ jobId, kind, label, done, disabled }: { jobId: string; kind: 'before' | 'after' | 'issue'; label: string; done: number; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          if (!files.length) return;
          setBusy(true); setErr(null);
          try {
            for (const f of files) {
              const path = await uploadJobPhoto(jobId, f);
              const r = await addJobPhoto({ jobId, kind, path });
              if (!r?.ok) throw new Error(r?.error);
            }
            router.refresh();
          } catch (x: any) { setErr(x.message ?? 'Upload failed'); }
          finally { setBusy(false); if (ref.current) ref.current.value = ''; }
        }} />
      <button type="button" disabled={busy || disabled} onClick={() => ref.current?.click()}
        className={cx('flex h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-sm font-medium disabled:opacity-50',
          done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-stone-300 bg-white text-stone-700')}>
        {busy ? <LoaderCircle className="size-6 animate-spin" /> : done ? <Check className="size-6" /> : <Camera className="size-6" />}
        {busy ? 'Uploading…' : label}
        {done > 0 && <span className="text-xs font-normal">{done} added · tap to add more</span>}
      </button>
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}

type Task = { id: string; area: string; task: string; is_required: boolean; requires_photo: boolean };
type Sub = { completed: boolean; notes: string | null; photo_path: string | null } | undefined;

export function Checklist({ jobId, tasks, subs, editable }: { jobId: string; tasks: Task[]; subs: Record<string, Sub>; editable: boolean }) {
  const areas = [...new Set(tasks.map((t) => t.area))];
  const done = tasks.filter((t) => subs[t.id]?.completed).length;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-sage-600 transition-all" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
        <span className="text-sm font-medium tabular-nums text-stone-600">{done}/{tasks.length}</span>
      </div>
      {!editable && <p className="mb-2 text-xs text-stone-500">Clock in to check off tasks.</p>}
      <div className="space-y-4">
        {areas.map((a) => (
          <div key={a}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{a}</div>
            <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {tasks.filter((t) => t.area === a).map((t) => <TaskRow key={t.id} jobId={jobId} task={t} sub={subs[t.id]} editable={editable} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskRow({ jobId, task, sub, editable }: { jobId: string; task: Task; sub: Sub; editable: boolean }) {
  const [checked, setChecked] = useState(!!sub?.completed);
  const [hasPhoto, setHasPhoto] = useState(!!sub?.photo_path);
  const [note, setNote] = useState(sub?.notes ?? '');
  const [showNote, setShowNote] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const needsPhoto = task.requires_photo && !hasPhoto;

  const save = (completed: boolean, photoPath?: string | null) => start(async () => {
    setErr(null);
    const r = await saveChecklistItem({ jobId, taskId: task.id, completed, notes: note || null, photoPath: photoPath ?? null });
    if (!r?.ok) { setErr(r?.error ?? 'Could not save'); setChecked(!completed); } else router.refresh();
  });

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" disabled={!editable || pending} aria-pressed={checked} aria-label={`Mark ${task.task} done`}
          onClick={() => { const v = !checked; setChecked(v); save(v); }}
          className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg border-2 transition-colors disabled:opacity-60',
            checked ? 'border-sage-600 bg-sage-600 text-white' : 'border-stone-300 bg-white')}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : checked && <Check className="size-5" />}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setShowNote((s) => !s)}>
          <span className={cx('text-[15px]', checked ? 'text-stone-500 line-through' : 'text-ink')}>{task.task}</span>
          <span className="ml-1.5 inline-flex gap-1 align-middle">
            {task.is_required && !checked && <Badge>Required</Badge>}
            {task.requires_photo && <Badge tone={hasPhoto ? 'green' : 'amber'}>{hasPhoto ? 'Photo ✓' : 'Photo needed'}</Badge>}
          </span>
        </button>
        {task.requires_photo && editable && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              start(async () => {
                try {
                  const path = await uploadJobPhoto(jobId, f);
                  setHasPhoto(true); setChecked(true);
                  const r = await saveChecklistItem({ jobId, taskId: task.id, completed: true, notes: note || null, photoPath: path });
                  if (!r?.ok) throw new Error(r?.error);
                  router.refresh();
                } catch (x: any) { setErr(x.message); }
              });
            }} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Add photo" className={cx('rounded-lg p-2', needsPhoto ? 'bg-amber-100 text-amber-800' : 'text-stone-500')}><ImagePlus className="size-5" /></button>
          </>
        )}
      </div>
      {showNote && editable && (
        <div className="mt-2 flex gap-2 pl-11">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className="h-9" />
          <button type="button" className="rounded-lg bg-stone-100 px-3 text-sm font-medium" onClick={() => save(checked)}>Save</button>
        </div>
      )}
      {sub?.notes && !showNote && <p className="mt-1 pl-11 text-xs text-stone-500">“{sub.notes}”</p>}
      {err && <p className="mt-1 pl-11 text-xs text-red-700">{err}</p>}
    </div>
  );
}
