import 'server-only';

/**
 * Address → coordinates for geofencing.
 * Uses Google Geocoding when GOOGLE_MAPS_API_KEY is set, otherwise OpenStreetMap Nominatim
 * (free, low-volume, attribution required). Returns null when the address can't be resolved;
 * managers can always enter or adjust coordinates manually.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address.trim()) return null;
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`, { cache: 'no-store' });
      const j = await r.json();
      const loc = j.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    }
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
      headers: { 'User-Agent': 'HeritageOperationsHub/1.0 (property geofencing)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch {
    return null;
  }
}
