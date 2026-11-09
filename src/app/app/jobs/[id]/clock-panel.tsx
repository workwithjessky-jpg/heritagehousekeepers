'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, LoaderCircle, CircleCheck, TriangleAlert, ShieldCheck, LogIn, LogOut } from 'lucide-react';
import { Button, Textarea, Select, cx } from '@/components/ui';
import { clockIn, clockOut, acceptLocationPolicy } from '../../actions';

type Geo = { lat: number; lng: number; accuracy: number };

/** One-shot GPS read — the app never watches location in the background. */
function getPosition(): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This device does not support location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied.' : e.code === 3 ? 'Getting your location timed out.' : 'Your location is unavailable right now.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

export function ClockPanel({
  jobId, openAttendanceId, openSince, clockedInElsewhere, alreadyWorked, jobClosed, consentAccepted, policyText, completion,
}: {
  jobId: string; openAttendanceId: string | null; openSince: string | null; clockedInElsewhere: boolean; alreadyWorked: boolean;
  jobClosed: boolean; consentAccepted: boolean; policyText: string;
  completion: { required_open: { id: string; area: string; task: string }[]; photos_missing: string[] };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'locating' | 'consent' | 'nogps'>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [breakMin, setBreakMin] = useState('0');
  const [exception, setException] = useState('');
  const [notes, setNotes] = useState('');
  const incomplete = completion.required_open.length > 0 || completion.photos_missing.length > 0;

  async function locate(): Promise<Geo | null> {
    setPhase('locating'); setGeoError(null);
    try { const g = await getPosition(); setPhase('idle'); return g; }
    catch (e: any) { setGeoError(e.message); setPhase('nogps'); return null; }
  }

  async function doClockIn(withoutGps = false) {
    setMsg(null);
    if (!consentAccepted && phase !== 'consent') { setPhase('consent'); return; }
    const g = withoutGps ? null : await locate();
    if (!g && !withoutGps) return; // shows the no-GPS form
    start(async () => {
      const r = await clockIn({ jobId, lat: g?.lat ?? null, lng: g?.lng ?? null, accuracy: g?.accuracy ?? null, reason: withoutGps ? reason : null });
      setMsg({ ok: r?.ok ?? false, text: (r?.ok ? r.message : r?.error) ?? '' });
      if (r?.ok) { setPhase('idle'); router.refresh(); }
    });
  }

  async function doClockOut(withoutGps = false) {
    setMsg(null);
    if (incomplete && !exception.trim()) { setMsg({ ok: false, text: 'Finish the checklist and photos, or explain below why they could not be completed.' }); return; }
    const g = withoutGps ? null : await locate();
    if (!g && !withoutGps) return;
    start(async () => {
      const r = await clockOut({ attendanceId: openAttendanceId!, lat: g?.lat ?? null, lng: g?.lng ?? null, accuracy: g?.accuracy ?? null,
        breakMinutes: Number(breakMin) || 0, exception: exception.trim() || null, notes: notes.trim() || null });
      setMsg({ ok: r?.ok ?? false, text: (r?.ok ? r.message : r?.error) ?? '' });
      if (r?.ok) { setPhase('idle'); router.refresh(); }
    });
  }

  const busy = pending || phase === 'locating';
  const Msg = msg && (
    <div className={cx('mt-3 flex gap-2 rounded-xl px-3 py-2.5 text-sm', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
      {msg.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}{msg.text}
    </div>
  );

  if (phase === 'consent') {
    return (
      <div className="rounded-2xl border border-sage-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2 font-semibold text-ink"><ShieldCheck className="size-5 text-sage-700" />Location policy</div>
        <p className="text-sm whitespace-pre-wrap text-stone-700">{policyText}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setPhase('idle')}>Not now</Button>
          <Button size="lg" disabled={pending} onClick={() => start(async () => {
            const r = await acceptLocationPolicy();
            if (r?.ok) { setPhase('idle'); router.refresh(); } else setMsg({ ok: false, text: r?.error ?? 'Could not save' });
          })}>I agree</Button>
        </div>
        {Msg}
      </div>
    );
  }

  if (jobClosed && !openAttendanceId) {
    return <div className="rounded-2xl bg-stone-100 p-4 text-center text-sm text-stone-600">{alreadyWorked ? 'You have clocked out of this job. Great work!' : 'This job is closed.'}</div>;
  }

  if (!openAttendanceId) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        {clockedInElsewhere ? (
          <p className="text-sm text-amber-800">You are still clocked in to another job. Clock out there first.</p>
        ) : alreadyWorked ? (
          <p className="mb-3 text-sm text-stone-600">You already worked a shift on this job. Clocking in again will be flagged for review.</p>
        ) : null}
        {phase === 'nogps' ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>{geoError} Turn on location for this site in your browser settings and try again, or clock in with an explanation for your manager.</span></div>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => doClockIn()} disabled={busy}>Try location again</Button>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is GPS unavailable? e.g. phone location broken, no signal in building" rows={2} />
            <Button size="lg" className="w-full" disabled={busy || reason.trim().length < 5} onClick={() => doClockIn(true)}>Clock in without GPS (needs approval)</Button>
          </div>
        ) : (
          <button disabled={busy || clockedInElsewhere} onClick={() => doClockIn()}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-sage-700 text-xl font-semibold text-white shadow-lg active:scale-[0.99] disabled:opacity-50">
            {busy ? <LoaderCircle className="size-7 animate-spin" /> : <LogIn className="size-7" />}
            {phase === 'locating' ? 'Getting location…' : pending ? 'Clocking in…' : 'CLOCK IN'}
          </button>
        )}
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-stone-500"><MapPin className="size-3.5" />Your location is checked once, only when you tap.</p>
        {Msg}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-sage-600 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold text-sage-800"><span className="relative flex size-3"><span className="absolute inline-flex size-full animate-ping rounded-full bg-sage-400 opacity-75" /><span className="relative inline-flex size-3 rounded-full bg-sage-600" /></span>On the clock</span>
        <span className="text-sm text-stone-600">since {openSince}</span>
      </div>

      {incomplete && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Before you finish:</div>
          <ul className="mt-1 list-disc pl-5">
            {completion.required_open.slice(0, 6).map((t) => <li key={t.id}>{t.area}: {t.task}</li>)}
            {completion.required_open.length > 6 && <li>+{completion.required_open.length - 6} more tasks</li>}
            {completion.photos_missing.map((k) => <li key={k}>Add a {k} photo</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-sm font-medium text-stone-700">Unpaid break taken
          <Select value={breakMin} onChange={(e) => setBreakMin(e.target.value)} className="mt-1 h-12 text-base">
            {[0, 10, 15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m === 0 ? 'No break' : `${m} minutes`}</option>)}
          </Select>
        </label>
        {incomplete && (
          <label className="block text-sm font-medium text-stone-700">Why couldn&apos;t everything be completed?
            <Textarea value={exception} onChange={(e) => setException(e.target.value)} rows={2} className="mt-1" placeholder="e.g. Client asked us to skip the garage; oven too dirty for time allotted" />
          </label>
        )}
        <label className="block text-sm font-medium text-stone-700">Notes for the office (optional)
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1" />
        </label>
        {phase === 'nogps' ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{geoError}</div>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => doClockOut()} disabled={busy}>Try location again</Button>
            <Button size="lg" className="w-full" onClick={() => doClockOut(true)} disabled={busy}>Clock out without GPS</Button>
          </div>
        ) : (
          <button disabled={busy} onClick={() => doClockOut()}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-ink text-xl font-semibold text-white shadow-lg active:scale-[0.99] disabled:opacity-50">
            {busy ? <LoaderCircle className="size-7 animate-spin" /> : <LogOut className="size-7" />}
            {phase === 'locating' ? 'Getting location…' : pending ? 'Clocking out…' : 'CLOCK OUT'}
          </button>
        )}
      </div>
      {Msg}
    </div>
  );
}
