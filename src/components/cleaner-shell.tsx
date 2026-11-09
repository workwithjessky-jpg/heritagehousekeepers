'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, CalendarDays, Clock, Wallet, User } from 'lucide-react';
import { NotificationBell } from './notification-bell';
import { cx } from './ui';

const TABS = [
  { href: '/app', label: 'Today', icon: House },
  { href: '/app/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/app/timesheets', label: 'Hours', icon: Clock },
  { href: '/app/earnings', label: 'Pay', icon: Wallet },
  { href: '/app/me', label: 'Me', icon: User },
];

export function CleanerShell({ userId, unread, children }: { userId: string; unread: number; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh bg-cream pb-[calc(72px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-white/90 px-4 backdrop-blur">
        <Link href="/app" className="leading-none">
          <span className="font-display text-base tracking-[0.14em] text-ink">HERITAGE</span>
          <span className="ml-2 font-display text-[10px] tracking-[0.3em] text-stone-500">HOUSEKEEPERS</span>
        </Link>
        <NotificationBell userId={userId} initialUnread={unread} href="/app/notifications" />
      </header>
      <main className="mx-auto max-w-xl px-4 py-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {TABS.map((t) => {
            const active = t.href === '/app' ? path === '/app' : path.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link key={t.href} href={t.href} className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', active ? 'text-sage-700' : 'text-stone-500')}>
                <Icon className={cx('size-6', active && 'stroke-[2.25]')} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
