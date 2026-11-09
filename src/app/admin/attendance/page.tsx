import Link from 'next/link';
import { requireRole, STAFF, getSettings, isSupervisor } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rangeUtc } from '@/lib/queries';
import { todayInTz, addDays, fmtDateTime, fmtTime } from '@/lib/format';
import { attendancePoints } from '@/lib/attendance-points';
import { Card, CardHeader, CardBody, PageHeader, Table, Th, Td, StatusBadge, LOC_STATUS, Flags, Badge, Input, Select, Empty, buttonClass, cx } from '@/components/ui';
import { ActionButton } from '@/components/forms';
import { AttendanceMap, MapLegend } from '@/components/map';
import { reviewAttendanceException } from '../_actions/jobs';

export const metadata = { title: 'Attendance & GPS' };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireRole(STAFF);
  const sp = await searchParams;
  const s = await getSettings();
  const tz = s.timezone;
  const today = todayInTz(tz);
  const from = sp.from || addDays(today, -6);
  const to = sp.to || today;
  const r = rangeUtc(from, addDays(to, 1), tz);
  const supabase = await createClient();

  let q = supabase.from('attendance_records')
    .select('*, user:users!attendance_records_employee_id_fkey(full_name), job:cleaning_jobs(id,title,scheduled_start,property:properties(id,name,address,latitude,longitude))')
    .gte('clock_in_at', r.from).lt('clock_in_at', r.to).order('clock_in_at', { ascending: false }).limit(500);
  if (sp.employee) q = q.eq('employee_id', sp.employee);
  if (sp.location) q = q.eq('clock_in_location', sp.location);
  if (sp.pending) q = q.eq('status', 'exception_pending');
  const [{ data: rows }, { data: cleaners }, { data: focus }] = await Promise.all([
    q,
    supabase.from('users').select('id,full_name').eq('role_key', 'cleaner').order('full_name'),
    sp.focus ? supabase.from('attendance_records').select('*, user:users!attendance_records_employee_id_fkey(full_name), job:cleaning_jobs(id,title,property:properties(id,name,address,latitude,longitude))').eq('id', sp.focus).single() : Promise.resolve({ data: null }),
  ]);
  const list = (rows ?? []) as any[];
  const mapRows = focus ? [focus] : list.slice(0, 150);
  const { points, links } = attendancePoints(mapRows, (iso) => fmtDateTime(iso, tz));
  const live = list.filter((a) => !a.clock_out_at);
  const pending = list.filter((a) => a.status === 'exception_pending');
  const outside = list.filter((a) => a.clock_in_location === 'outside_geofence');

  return (
    <>
      <PageHeader title="Attendance & GPS verification" subtitle="Locations are captured only at clock-in and clock-out of a scheduled job." />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="text-[13px] text-stone-500">Clock-ins</div><div className="text-2xl font-semibold">{list.length}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">On the clock now</div><div className="text-2xl font-semibold">{live.length}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Outside geofence</div><div className={cx('text-2xl font-semibold', outside.length && 'text-red-700')}>{outside.length}</div></Card>
        <Card className="p-4"><div className="text-[13px] text-stone-500">Exceptions awaiting review</div><div className={cx('text-2xl font-semibold', pending.length && 'text-amber-700')}>{pending.length}</div></Card>
      </div>

      <Card className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-2" action="/admin/attendance">
          <label className="text-xs text-stone-500">From<Input type="date" name="from" defaultValue={from} className="w-40" /></label>
          <label className="text-xs text-stone-500">To<Input type="date" name="to" defaultValue={to} className="w-40" /></label>
          <Select name="employee" defaultValue={sp.employee ?? ''} className="w-48">
            <option value="">All cleaners</option>{(cleaners ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </Select>
          <Select name="location" defaultValue={sp.location ?? ''} className="w-48">
            <option value="">Any location status</option>{Object.entries(LOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <label className="flex items-center gap-2 px-2 text-sm text-stone-600"><input type="checkbox" name="pending" value="1" defaultChecked={!!sp.pending} className="accent-sage-700" />Pending only</label>
          <button className={buttonClass('secondary')}>Apply</button>
        </form>
      </Card>

      <Card className="mb-6">
        <CardHeader title={focus ? `Location review · ${focus.user?.full_name}` : 'Clock-in locations'} subtitle={focus ? <Link href="/admin/attendance" className="text-sage-700 underline">Show all records</Link> : `Showing ${mapRows.length} records on the map`} />
        <CardBody>
          {points.length ? <><AttendanceMap points={points} links={links} height={380} /><MapLegend /></> : <Empty title="No GPS points in this range" />}
        </CardBody>
      </Card>

      <Card>
        {list.length === 0 ? <Empty title="No attendance records in this range" /> : (
          <Table>
            <thead><tr><Th>Cleaner</Th><Th>Job / property</Th><Th>Clock in</Th><Th>Clock out</Th><Th>Worked</Th><Th>Location</Th><Th>Flags</Th><Th /></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={cx(sp.focus === a.id && 'bg-amber-50')}>
                  <Td className="font-medium text-ink">{a.user?.full_name}</Td>
                  <Td><Link className="hover:text-sage-700" href={`/admin/jobs/${a.job?.id}`}>{a.job?.title}</Link><div className="text-xs text-stone-500">{a.job?.property?.name}</div></Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.clock_in_at, tz)}{a.clock_in_distance_m != null && <div className="text-xs text-stone-500">{Math.round(a.clock_in_distance_m)} m away · ±{Math.round(a.clock_in_accuracy_m ?? 0)} m</div>}</Td>
                  <Td className="whitespace-nowrap">{a.clock_out_at ? fmtTime(a.clock_out_at, tz) : <Badge tone="amber">On the clock</Badge>}{a.clock_out_distance_m != null && <div className="text-xs text-stone-500">{Math.round(a.clock_out_distance_m)} m away</div>}</Td>
                  <Td className="tabular-nums">{a.total_minutes != null ? `${(a.total_minutes / 60).toFixed(2)} h` : '—'}{a.break_minutes ? <div className="text-xs text-stone-500">{a.break_minutes} min break</div> : null}</Td>
                  <Td><StatusBadge map={LOC_STATUS} value={a.clock_in_location} />{a.exception_reason && <div className="mt-1 max-w-48 text-xs text-amber-800">“{a.exception_reason}”</div>}</Td>
                  <Td><Flags flags={a.flags} /></Td>
                  <Td className="whitespace-nowrap">
                    {a.clock_in_latitude != null && <Link className="mr-2 text-xs text-sage-700 underline" href={`/admin/attendance?focus=${a.id}`}>Map</Link>}
                    {a.status === 'exception_pending' && (isSupervisor(me.role) ? (
                      <span className="inline-flex gap-1">
                        <ActionButton action={reviewAttendanceException} fields={{ id: a.id, decision: 'approve' }} variant="success">Approve</ActionButton>
                        <ActionButton action={reviewAttendanceException} fields={{ id: a.id, decision: 'reject' }} variant="danger">Reject</ActionButton>
                      </span>
                    ) : <Badge tone="amber">Pending</Badge>)}
                    {a.status === 'exception_approved' && <Badge tone="green">Exception approved</Badge>}
                    {a.status === 'exception_rejected' && <Badge tone="red">Exception rejected</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
