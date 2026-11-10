import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Phone push notifications (Web Push).
 * Keys live in the server-only `app_secrets` table and are created automatically on first use,
 * so there is nothing to paste into Vercel. A database trigger calls /api/push/dispatch for
 * every new notification of a user who turned on phone alerts.
 */
type Db = SupabaseClient;
type Keys = { publicKey: string; privateKey: string; dispatchKey: string };

const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/$/, '');

export async function pushKeys(db: Db): Promise<Keys> {
  const { data } = await db.from('app_secrets').select('key,value').in('key', ['vapid_public', 'vapid_private', 'push_dispatch_key', 'push_dispatch_url']);
  const m = new Map((data ?? []).map((r: any) => [r.key, r.value as string]));
  // keep the database trigger pointed at this deployment's address
  const url = site() ? `${site()}/api/push/dispatch` : null;
  if (url && m.get('push_dispatch_url') !== url) {
    await db.from('app_secrets').upsert({ key: 'push_dispatch_url', value: url, updated_at: new Date().toISOString() });
  }
  if (m.get('vapid_public') && m.get('vapid_private') && m.get('push_dispatch_key')) {
    return { publicKey: m.get('vapid_public')!, privateKey: m.get('vapid_private')!, dispatchKey: m.get('push_dispatch_key')! };
  }
  // first use: create the keys (if two requests race, ignoreDuplicates keeps the first set) and re-read
  const v = webpush.generateVAPIDKeys();
  await db.from('app_secrets').upsert([
    { key: 'vapid_public', value: v.publicKey }, { key: 'vapid_private', value: v.privateKey },
    { key: 'push_dispatch_key', value: randomBytes(32).toString('base64url') },
  ], { onConflict: 'key', ignoreDuplicates: true });
  const { data: again } = await db.from('app_secrets').select('key,value').in('key', ['vapid_public', 'vapid_private', 'push_dispatch_key']);
  const k = new Map((again ?? []).map((r: any) => [r.key, r.value as string]));
  if (!k.get('vapid_public') || !k.get('vapid_private') || !k.get('push_dispatch_key')) throw new Error('Could not set up push keys');
  return { publicKey: k.get('vapid_public')!, privateKey: k.get('vapid_private')!, dispatchKey: k.get('push_dispatch_key')! };
}

export function checkDispatchKey(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sends one notification to every phone/browser the user turned alerts on for. Removes dead subscriptions. */
export async function sendPushForNotification(db: Db, notificationId: string) {
  const { data: n } = await db.from('notifications').select('id,user_id,title,body,link,type').eq('id', notificationId).maybeSingle();
  if (!n) return { sent: 0, removed: 0 };
  const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', n.user_id);
  if (!subs?.length) return { sent: 0, removed: 0 };
  const keys = await pushKeys(db);
  const subject = site() || 'https://heritagehousekeepers.vercel.app';
  const payload = JSON.stringify({
    title: n.title, body: n.body ?? '', tag: `${n.type}:${n.id}`,
    // open through /notifications/<id> so the alert is also marked read
    url: n.link ? `/notifications/${n.id}` : '/',
  });
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600, urgency: 'high',
      });
      sent++;
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from('push_subscriptions').delete().eq('id', s.id); removed++; }
    }
  }));
  return { sent, removed };
}
