import type { MapPoint } from '@/components/map-inner';

/** Builds map points (property + clock-in/out locations) for attendance records. */
export function attendancePoints(records: any[], tzFmt: (iso: string) => string) {
  const points: MapPoint[] = [];
  const links: [number, number][][] = [];
  const seen = new Set<string>();
  for (const a of records) {
    const p = a.job?.property ?? a.property;
    if (p?.latitude != null && !seen.has(p.id)) {
      seen.add(p.id);
      points.push({ lat: p.latitude, lng: p.longitude, label: p.name, kind: 'property', radius: a.geofence_radius_m });
    }
    const who = a.user?.full_name ?? 'Cleaner';
    if (a.clock_in_latitude != null) {
      points.push({
        lat: a.clock_in_latitude, lng: a.clock_in_longitude,
        label: `${who} in · ${tzFmt(a.clock_in_at)} · ${Math.round(a.clock_in_distance_m ?? 0)} m`,
        kind: a.clock_in_location === 'outside_geofence' ? 'outside' : 'verified',
      });
      if (a.clock_in_location === 'outside_geofence' && p?.latitude != null) {
        links.push([[a.clock_in_latitude, a.clock_in_longitude], [p.latitude, p.longitude]]);
      }
    }
    if (a.clock_out_latitude != null) {
      points.push({ lat: a.clock_out_latitude, lng: a.clock_out_longitude, label: `${who} out · ${tzFmt(a.clock_out_at)}`, kind: 'clock_out' });
    }
  }
  return { points, links };
}
