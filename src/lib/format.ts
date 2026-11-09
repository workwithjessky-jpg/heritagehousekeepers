// Formatting + time-zone helpers. All timestamps are stored as UTC (timestamptz) and
// displayed in the company time zone from Settings, so managers and cleaners see the same times.

export function fmtMoney(n: number | string | null | undefined, currency = 'USD') {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
}

export function fmtHours(n: number | string | null | undefined) {
  return `${Number(n ?? 0).toFixed(2)} h`;
}

export function fmtDate(iso: string | Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', ...opts }).format(new Date(iso));
}

export function fmtTime(iso: string | Date | null | undefined, tz: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | Date | null | undefined, tz: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

/** A plain YYYY-MM-DD date column (no time zone) → "Nov 9, 2026" */
export function fmtPlainDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...opts })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

/** Offset (minutes) of `tz` from UTC at the given instant. */
function tzOffsetMinutes(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - date.getTime()) / 60000;
}

/** "2026-11-09T09:30" (wall time in tz) → ISO UTC string */
export function zonedToUtc(local: string, tz: string): string {
  const [d, t = '00:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, day, hh, mm));
  const offset = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - offset * 60000);
  // second pass handles DST boundaries
  const offset2 = tzOffsetMinutes(result, tz);
  return new Date(guess.getTime() - offset2 * 60000).toISOString();
}

/** ISO → "YYYY-MM-DDTHH:mm" in tz, for <input type="datetime-local"> */
export function utcToZonedInput(iso: string | Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Today's date (YYYY-MM-DD) in tz */
export function todayInTz(tz: string, base = new Date()) {
  return utcToZonedInput(base, tz).slice(0, 10);
}

export function addDays(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday */
export function weekday(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeek(dateStr: string) {
  const wd = weekday(dateStr);
  return addDays(dateStr, -((wd + 6) % 7)); // Monday
}

export function mapsUrl(address: string, lat?: number | null, lng?: number | null) {
  const dest = lat != null && lng != null ? `${lat},${lng}` : address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

export function titleCase(s: string | null | undefined) {
  return (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}
