'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase/client';

/**
 * Live unread counter. Subscribes to Supabase Realtime inserts on the user's own
 * notifications (RLS limits the stream to rows the user can read) and refreshes
 * server components so dashboards update without a reload.
 */
export function NotificationBell({ userId, initialUnread, href }: { userId: string; initialUnread: number; href: string }) {
  const [unread, setUnread] = useState(initialUnread);
  const [toast, setToast] = useState<{ title: string; body?: string; link?: string } | null>(null);
  const router = useRouter();

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload: any) => {
          setUnread((n) => n + 1);
          setToast({ title: payload.new.title, body: payload.new.body, link: payload.new.link });
          router.refresh();
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <Link href={href} className="relative rounded-xl p-2 text-stone-600 hover:bg-stone-100" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      {toast && (
        <div className="fixed right-4 bottom-20 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-stone-200 bg-white p-4 shadow-xl sm:bottom-4">
          <button onClick={() => setToast(null)} className="absolute top-2 right-3 text-stone-400 hover:text-stone-600" aria-label="Dismiss">×</button>
          <p className="pr-4 text-sm font-semibold text-ink">{toast.title}</p>
          {toast.body && <p className="mt-0.5 text-sm text-stone-600">{toast.body}</p>}
          {toast.link && <Link href={toast.link} onClick={() => setToast(null)} className="mt-2 inline-block text-sm font-medium text-sage-700 hover:underline">Open</Link>}
        </div>
      )}
    </>
  );
}
