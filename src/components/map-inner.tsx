'use client';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip, Polyline } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';

export type MapPoint = {
  lat: number; lng: number; label: string;
  kind: 'property' | 'verified' | 'outside' | 'clock_out';
  radius?: number; // geofence (m) for property points
};

const COLOR = { property: '#44583b', verified: '#059669', outside: '#dc2626', clock_out: '#0284c7' };

export default function MapInner({ points, height = 320, links = [] }: { points: MapPoint[]; height?: number; links?: [number, number][][] }) {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const pad = 0.002;
  const bounds: LatLngBoundsExpression = [[Math.min(...lats) - pad, Math.min(...lngs) - pad], [Math.max(...lats) + pad, Math.max(...lngs) + pad]];
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl border border-stone-200">
      <MapContainer bounds={bounds} scrollWheelZoom={false} style={{ height: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {links.map((l, i) => <Polyline key={i} positions={l} pathOptions={{ color: '#dc2626', dashArray: '4 6', weight: 2 }} />)}
        {points.map((p, i) => (
          <span key={i}>
            {p.kind === 'property' && p.radius && (
              <Circle center={[p.lat, p.lng]} radius={p.radius} pathOptions={{ color: COLOR.property, fillOpacity: 0.08, weight: 1 }} />
            )}
            <CircleMarker center={[p.lat, p.lng]} radius={p.kind === 'property' ? 9 : 7}
              pathOptions={{ color: 'white', weight: 2, fillColor: COLOR[p.kind], fillOpacity: 1 }}>
              <Tooltip>{p.label}</Tooltip>
            </CircleMarker>
          </span>
        ))}
      </MapContainer>
    </div>
  );
}
