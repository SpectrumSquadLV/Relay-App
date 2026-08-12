// ============================================================
// Geocoding service — address -> { lat, lng }
// Provider-agnostic. Default: OpenStreetMap Nominatim (free, no key).
// Swap to Google/Mapbox by setting env vars — no other code changes.
//   GEOCODER_PROVIDER = nominatim | google | mapbox | mock
//   GEOCODER_API_KEY  = <key>            (google/mapbox only)
// Fails soft: returns null on any error so the app never crashes on a
// bad address or a network hiccup.
// ============================================================
const cache = new Map();
const provider = () => process.env.GEOCODER_PROVIDER || 'nominatim';

function fullAddress(address, zip) {
  return [address, zip].filter(Boolean).join(', ');
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: opts.headers || {} });
  if (!res.ok) throw new Error('geocoder http ' + res.status);
  return res.json();
}

// --- providers ---
async function nominatim(q) {
  // Nominatim usage policy: identify via User-Agent, keep volume low.
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
  const j = await fetchJSON(url, { headers: { 'User-Agent': 'Relay-CRM/1.0 (relayitcrm.com)' } });
  if (Array.isArray(j) && j[0]) return { lat: +j[0].lat, lng: +j[0].lon, source: 'nominatim' };
  return null;
}
async function google(q) {
  const key = process.env.GEOCODER_API_KEY;
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(q) + '&key=' + key;
  const j = await fetchJSON(url);
  const r = j.results && j.results[0];
  if (r) return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, source: 'google' };
  return null;
}
async function mapbox(q) {
  const key = process.env.GEOCODER_API_KEY;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&country=us&access_token=${key}`;
  const j = await fetchJSON(url);
  const f = j.features && j.features[0];
  if (f) return { lat: f.center[1], lng: f.center[0], source: 'mapbox' };
  return null;
}
// Deterministic offline geocoder for local dev/testing (no network).
// Spreads addresses around a base point using a stable string hash.
function mock(q) {
  let h = 0; for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) & 0xffffffff;
  const base = [36.1215, -115.1739]; // Las Vegas
  const dLat = ((h % 1000) / 1000 - 0.5) * 0.5;
  const dLng = (((h >> 10) % 1000) / 1000 - 0.5) * 0.5;
  return { lat: +(base[0] + dLat).toFixed(5), lng: +(base[1] + dLng).toFixed(5), source: 'mock' };
}

async function geocode(address, zip) {
  const q = fullAddress(address, zip);
  if (!q) return null;
  const key = provider() + '::' + q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const p = provider();
    if (p === 'mock') result = mock(q.toLowerCase());
    else if (p === 'google') result = await google(q);
    else if (p === 'mapbox') result = await mapbox(q);
    else result = await nominatim(q);
  } catch (e) {
    result = null; // fail soft
  }
  if (result) cache.set(key, result);
  return result;
}

module.exports = { geocode };
