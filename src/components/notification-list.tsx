import Link from 'next/link';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { Card, CardHeader, Empty, cx } from './ui';
import { ActionButton } from './forms';
import { markNotificationsRead } from '@/app/admin/_actions/people';

/** Notification center shared by both portals (RLS returns only the viewer's own rows). */
export async function NotificationList({ tz, limit = 100 }: { tz: string; limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  const list = (data ?? []) as any[];
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <Card>
      <CardHeader title="Notifications" subtitle={`${unread} unread`} action={unread > 0 && <ActionButton action={markNotificationsRead} fields={{}}>Mark all read</ActionButton>} />
      {list.length === 0 ? <Empty title="You're all caught up" icon={<Bell className="size-5" />} /> : (
        <ul className="divide-y divide-stone-100">
          {list.map((n) => (
            <li key={n.id} className={cx('flex items-start gap-3 px-5 py-3', !n.read_at && 'bg-sage-50/50')}>
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-sage-600')} />
              <div className="min-w-0 flex-1">
                {n.link ? <Link href={n.link} className="text-sm font-medium text-ink hover:text-sage-700">{n.title}</Link> : <span className="text-sm font-medium text-ink">{n.title}</span>}
                {n.body && <p className="text-sm text-stone-600">{n.body}</p>}
                <p className="text-xs text-stone-400">{fmtDateTime(n.created_at, tz)}</p>
              </div>
              {!n.read_at && <ActionButton action={markNotificationsRead} fields={{ id: n.id }} variant="ghost">Mark read</ActionButton>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
