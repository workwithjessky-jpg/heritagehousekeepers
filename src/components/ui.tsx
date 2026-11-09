import Link from 'next/link';
import clsx from 'clsx';
import type { ReactNode, ComponentProps } from 'react';

export const cx = clsx;

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cx('rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(30,35,30,0.04)]', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl tracking-wide text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BTN = {
  primary: 'bg-sage-700 text-white hover:bg-sage-800 focus-visible:outline-sage-700',
  secondary: 'bg-white text-ink border border-stone-300 hover:bg-stone-50 focus-visible:outline-stone-400',
  ghost: 'text-stone-600 hover:bg-stone-100',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 focus-visible:outline-red-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
} as const;
const SIZE = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-14 px-6 text-base' } as const;

export type ButtonVariant = keyof typeof BTN;
export function buttonClass(variant: ButtonVariant = 'primary', size: keyof typeof SIZE = 'md', className?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
    BTN[variant], SIZE[size], className,
  );
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ComponentProps<'button'> & { variant?: ButtonVariant; size?: keyof typeof SIZE }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({ href, variant = 'primary', size = 'md', className, children, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof SIZE }) {
  return <Link href={href} className={buttonClass(variant, size, className)} {...rest}>{children}</Link>;
}

const FIELD = 'block w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-sage-500 focus:outline-none focus:ring-2 focus:ring-sage-200 disabled:bg-stone-50';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(FIELD, 'h-10', className)} {...rest} />;
}
export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(FIELD, 'min-h-20', className)} {...rest} />;
}
export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return <select className={cx(FIELD, 'h-10 pr-8', className)} {...rest}>{children}</select>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, className, ...rest }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2.5 text-sm text-stone-700', className)}>
      <input type="checkbox" className="size-4 rounded border-stone-300 accent-sage-700" {...rest} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- status badges
const TONE = {
  gray: 'bg-stone-100 text-stone-700 ring-stone-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  sage: 'bg-sage-50 text-sage-800 ring-sage-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
} as const;
export type Tone = keyof typeof TONE;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONE[tone], className)}>
      {children}
    </span>
  );
}

export const JOB_STATUS: Record<string, { label: string; tone: Tone; dot: string }> = {
  scheduled: { label: 'Scheduled', tone: 'gray', dot: 'bg-stone-400' },
  assigned: { label: 'Assigned', tone: 'blue', dot: 'bg-sky-500' },
  confirmed: { label: 'Confirmed', tone: 'indigo', dot: 'bg-indigo-500' },
  in_progress: { label: 'In Progress', tone: 'amber', dot: 'bg-amber-500' },
  completed: { label: 'Completed', tone: 'green', dot: 'bg-emerald-500' },
  cancelled: { label: 'Cancelled', tone: 'red', dot: 'bg-red-400' },
  needs_attention: { label: 'Needs Attention', tone: 'violet', dot: 'bg-violet-500' },
};

export const TS_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  submitted: { label: 'Submitted', tone: 'blue' },
  under_review: { label: 'Under Review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  paid: { label: 'Paid', tone: 'sage' },
};

export const LOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  verified: { label: 'Location verified', tone: 'green' },
  outside_geofence: { label: 'Outside geofence', tone: 'red' },
  unavailable: { label: 'GPS unavailable', tone: 'amber' },
  no_property_coordinates: { label: 'Property not mapped', tone: 'gray' },
};

export const REQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export const PAYROLL_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'gray' },
  generated: { label: 'Generated', tone: 'blue' },
  approved: { label: 'Approved', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
};

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const s = map[value] ?? { label: value, tone: 'gray' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const FLAG_LABEL: Record<string, string> = {
  outside_geofence: 'Outside geofence', gps_unavailable: 'No GPS', late_clock_in: 'Late', duplicate_clock_in: 'Duplicate clock-in',
  unusually_long_shift: 'Long shift', excessive_weekly_hours: 'High weekly hours', manual_adjustment: 'Manual adjustment',
  missing_clock_out: 'Missing clock-out', auto_break_applied: 'Auto break', missed_punch: 'Missed punch',
  clock_out_outside_geofence: 'Clock-out outside geofence', gps_unavailable_clock_out: 'No GPS at clock-out', property_not_geocoded: 'Property not mapped',
};
export function Flags({ flags }: { flags: string[] | null | undefined }) {
  if (!flags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {[...new Set(flags)].map((f) => (
        <Badge key={f} tone={['auto_break_applied', 'late_clock_in'].includes(f) ? 'amber' : 'red'}>{FLAG_LABEL[f] ?? f}</Badge>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'default', href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'warn' | 'good'; href?: string }) {
  const body = (
    <Card className={cx('h-full p-4 transition-shadow', href && 'hover:shadow-md')}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-stone-500">{label}</span>
        {icon && <span className={cx('rounded-lg p-1.5', tone === 'warn' ? 'bg-amber-50 text-amber-700' : tone === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-sage-50 text-sage-700')}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 rounded-full bg-sage-50 p-3 text-sage-600">{icon}</div>}
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('border-b border-stone-200 bg-stone-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500', className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx('border-b border-stone-100 px-4 py-3 align-top text-stone-700', className)}>{children}</td>;
}

export function DemoTag({ show }: { show?: boolean }) {
  if (!show) return null;
  return <Badge tone="violet" className="uppercase tracking-wide">Demo</Badge>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap', active === t.key ? 'bg-white text-ink shadow-sm' : 'text-stone-600 hover:text-ink')}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-stone-100', className)}>
      <div className="h-full rounded-full bg-sage-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
