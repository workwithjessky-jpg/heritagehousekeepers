'use client';
import dynamic from 'next/dynamic';
import type { MapPoint } from './map-inner';

export type { MapPoint };

// Leaflet touches `window`, so it is loaded only in the browser.
export const AttendanceMap = dynamic(() => import('./map-inner'), {
  ssr: false,
  loading: () => <div className="flex h-[320px] items-center justify-center rounded-xl bg-stone-100 text-sm text-stone-500">Loading map…</div>,
});

export function MapLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600">
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#44583b]" />Property & geofence</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-600" />Clock-in verified</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-600" />Clock-in outside geofence</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-sky-600" />Clock-out</span>
    </div>
  );
}
