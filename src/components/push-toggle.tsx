'use client';
import { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone, LoaderCircle } from 'lucide-react';
import { Button } from './ui';

type State = 'checking' | 'unsupported' | 'ios-home-screen' | 'blocked' | 'off' | 'on';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** "Turn on phone alerts": registers the service worker and saves this phone's push subscription. */
export function PushToggle() {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(isIos && !standalone ? 'ios-home-screen' : 'unsupported'); return;
      }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  async function turnOn() {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch('/api/push/key')).json();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save');
      setState('on');
      await sendTest();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Something went wrong' });
    } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState('off');
    } finally { setBusy(false); }
  }

  async function sendTest() {
    const r = await fetch('/api/push/test', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok && j.sent > 0 ? { ok: true, text: 'Test alert sent — check your phone.' } : { ok: false, text: j.error || 'The test alert could not be delivered. Turn alerts off and on again.' });
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-xl bg-sage-50 p-2 text-sage-700"><Smartphone className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">Phone alerts</div>
          <p className="text-sm text-stone-600">
            {state === 'on' && 'On for this phone. You get alerts even when the app is closed.'}
            {state === 'off' && 'Get a notification on this phone when something needs you — even when the app is closed.'}
            {state === 'checking' && 'Checking this device…'}
            {state === 'blocked' && 'Notifications are blocked for this site. Allow them in your phone or browser settings, then reload.'}
            {state === 'unsupported' && 'This browser cannot receive push alerts. On Android use Chrome; on iPhone add the app to your Home Screen first.'}
            {state === 'ios-home-screen' && <>On iPhone, first tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. Open Heritage Ops from your Home Screen, sign in, and come back here.</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state === 'off' && <Button onClick={turnOn} disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <BellRing className="size-4" />} Turn on phone alerts</Button>}
            {state === 'on' && <>
              <Button variant="secondary" onClick={() => { setBusy(true); sendTest().finally(() => setBusy(false)); }} disabled={busy}>Send test alert</Button>
              <Button variant="ghost" onClick={turnOff} disabled={busy}><BellOff className="size-4" /> Turn off</Button>
            </>}
          </div>
          {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-sage-700' : 'text-red-700'}`}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}
