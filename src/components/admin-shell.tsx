'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, MapPin, Clock, Wallet, Users, Plane, Building2, ShieldCheck, ListChecks,
  Megaphone, BarChart3, Settings, History, Menu, X, LogOut, Bell, Plus, Camera,
} from 'lucide-react';
import { Logo } from './brand';
import { NotificationBell } from './notification-bell';
import { cx } from './ui';

type Role = 'owner' | 'ops_manager' | 'office_admin' | 'cleaner';
const ALL: Role[] = ['owner', 'ops_manager', 'office_admin'];
const SUP: Role[] = ['owner', 'ops_manager'];

export const ADMIN_NAV: { href: string; label: string; icon: any; roles: Role[]; group: string; also?: string[] }[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, roles: ALL, group: 'Operations' },
  { href: '/admin/schedule', label: 'Schedule & Jobs', icon: CalendarDays, roles: ALL, group: 'Operations', also: ['/admin/jobs'] },
  { href: '/admin/attendance', label: 'Attendance & GPS', icon: MapPin, roles: ALL, group: 'Operations' },
  { href: '/admin/quality', label: 'Quality Control', icon: ShieldCheck, roles: ALL, group: 'Operations' },
  { href: '/admin/photos', label: 'Photos', icon: Camera, roles: ALL, group: 'Operations' },
  { href: '/admin/timesheets', label: 'Timesheets', icon: Clock, roles: ALL, group: 'People & Pay' },
  { href: '/admin/payroll', label: 'Payroll', icon: Wallet, roles: SUP, group: 'People & Pay' },
  { href: '/admin/employees', label: 'Employees', icon: Users, roles: ALL, group: 'People & Pay' },
  { href: '/admin/time-off', label: 'Time Off', icon: Plane, roles: ALL, group: 'People & Pay' },
  { href: '/admin/clients', label: 'Clients & Properties', icon: Building2, roles: ALL, group: 'Customers', also: ['/admin/properties'] },
  { href: '/admin/checklists', label: 'Checklists', icon: ListChecks, roles: ALL, group: 'Customers' },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell, roles: ALL, group: 'Company' },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone, roles: ALL, group: 'Company' },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, roles: SUP, group: 'Company' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, roles: ['owner'], group: 'Company' },
  { href: '/admin/audit', label: 'Audit Log', icon: History, roles: ['owner'], group: 'Company' },
];

export function AdminShell({ user, unread, children }: { user: { id: string; full_name: string; role: Role; roleLabel: string }; unread: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const items = ADMIN_NAV.filter((i) => i.roles.includes(user.role));
  const groups = [...new Set(items.map((i) => i.group))];

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g}</div>
          <div className="space-y-0.5">
            {items.filter((i) => i.group === g).map((i) => {
              const under = (h: string) => path === h || path.startsWith(h + '/');
              const active = i.href === '/admin' ? path === '/admin' : [i.href, ...(i.also ?? [])].some(under);
              const Icon = i.icon;
              return (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                  className={cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    active ? 'bg-sage-100 text-sage-900' : 'text-stone-600 hover:bg-stone-100 hover:text-ink')}>
                  <Icon className={cx('size-[18px]', active ? 'text-sage-700' : 'text-stone-400')} />
                  {i.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-stone-200 p-3">
      <div className="px-3 pb-2">
        <div className="truncate text-sm font-medium text-ink">{user.full_name}</div>
        <div className="text-xs text-stone-500">{user.roleLabel}</div>
      </div>
      <form action="/auth/signout" method="post">
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">
          <LogOut className="size-[18px] text-stone-400" /> Sign out
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-stone-200 bg-white lg:flex">
        <Link href="/admin" className="block border-b border-stone-200 px-6 py-5">
          <Logo className="h-auto w-44" />
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-sage-700">Operations Hub</div>
        </Link>
        {nav}
        {footer}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <Logo className="h-auto w-36" />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 hover:bg-stone-100"><X className="size-5" /></button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-stone-200 bg-white/85 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button className="rounded-lg p-1.5 hover:bg-stone-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <Logo className="h-7 w-auto lg:hidden" />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/jobs/new" className="inline-flex items-center gap-1.5 rounded-xl bg-sage-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sage-800">
            <Plus className="size-4" /> <span className="hidden sm:inline">New job</span>
          </Link>
          <NotificationBell userId={user.id} initialUnread={unread} href="/admin/notifications" />
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
