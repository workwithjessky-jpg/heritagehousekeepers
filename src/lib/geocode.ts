import 'server-only';

/**
 * Address → coordinates for geofencing.
 * 1. Google Geocoding when GOOGLE_MAPS_API_KEY is set.
 * 2. US Census Bureau geocoder (free, no key, knows new subdivision streets OpenStreetMap often lacks).
 * 3. OpenStreetMap Nominatim as a last resort (free, low-volume).
 * Returns null when the address can't be resolved; managers can always enter coordinates manually.
 */
type Point = { lat: number; lng: number };

async function google(address: string, key: string): Promise<Point | null> {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const loc = (await r.json()).results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function census(address: string): Promise<Point | null> {
  const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const m = (await r.json()).result?.addressMatches?.[0]?.coordinates;
  return m && Number.isFinite(m.y) && Number.isFinite(m.x) ? { lat: Number(m.y), lng: Number(m.x) } : null;
}

async function nominatim(address: string): Promise<Point | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
    headers: { 'User-Agent': 'HeritageOperationsHub/1.0 (property geofencing)' }, cache: 'no-store', signal: AbortSignal.timeout(6000),
  });
  const j = await r.json();
  return j?.[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
}

export async function geocodeAddress(address: string): Promise<Point | null> {
  if (!address.trim()) return null;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const providers = [...(key ? [() => google(address, key)] : []), () => census(address), () => nominatim(address)];
  for (const p of providers) {
    try { const hit = await p(); if (hit) return hit; } catch { /* try the next provider */ }
  }
  return null;
}
