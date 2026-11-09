import 'server-only';
import { createClient } from './supabase/server';
import { addDays, startOfWeek, todayInTz, zonedToUtc } from './format';

/** UTC bounds of [from, to) local dates in tz */
export function rangeUtc(fromDate: string, toDateExclusive: string, tz: string) {
  return { from: zonedToUtc(`${fromDate}T00:00`, tz), to: zonedToUtc(`${toDateExclusive}T00:00`, tz) };
}

export function todayRange(tz: string) {
  const today = todayInTz(tz);
  return { today, ...rangeUtc(today, addDays(today, 1), tz) };
}

export function weekRange(tz: string, date?: string) {
  const mon = startOfWeek(date ?? todayInTz(tz));
  return { start: mon, end: addDays(mon, 7), ...rangeUtc(mon, addDays(mon, 7), tz) };
}

export async function currentPeriod(tz: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('period_for_date', { p_date: todayInTz(tz) });
  const p = Array.isArray(data) ? data[0] : data;
  return p as { start_date: string; end_date: string; pay_date: string } | null;
}

/** Jobs with property, client and assigned cleaners (names) — RLS decides which rows are visible. */
export const JOB_SELECT =
  'id,title,cleaning_type,scheduled_start,scheduled_end,status,price,instructions,is_demo,recurrence_rule,recurrence_group_id,quality_status,checklist_id,' +
  'property:properties(id,name,address,latitude,longitude),client:clients(id,name),' +
  'job_assignments(employee_id,is_team_lead,status,user:users!job_assignments_employee_id_fkey(full_name))';
