import 'dotenv/config';

// Builds src/lib/abuja-routes.json — the road geometry the Blue Fleet demo
// cars drive along.
//
//   DOTENV_CONFIG_PATH=.env.demo npx tsx src/build-abuja-routes.ts
//
// One Directions call per loop, taking the per-step polylines rather than the
// overview one, so every bend of the road is in the file and a car at city
// zoom stays on the carriageway instead of cutting across blocks. The result
// is committed: it is route geometry, not a secret, and the demo must not
// spend a Directions call on every boot.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { decodePolyline } from './lib/directions';
import type { GeoPoint } from './lib/route-corridor';
import { ABUJA_LOOP_DEFINITIONS, TRT_OFFICE } from './lib/abuja-routes';

const KEY = process.env.GOOGLE_MAPS_API_KEY;

async function fetchPath(origin: GeoPoint, destination: GeoPoint, via: GeoPoint[] = []): Promise<GeoPoint[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  if (via.length) url.searchParams.set('waypoints', via.map((p) => `${p.lat},${p.lng}`).join('|'));
  url.searchParams.set('key', KEY!);

  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    status: string;
    error_message?: string;
    routes?: Array<{ legs: Array<{ steps: Array<{ polyline: { points: string } }> }> }>;
  };
  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(`Directions ${data.status}: ${data.error_message ?? 'no route'}`);
  }

  const path: GeoPoint[] = [];
  for (const leg of data.routes[0].legs) {
    for (const step of leg.steps) {
      for (const p of decodePolyline(step.polyline.points)) {
        const last = path[path.length - 1];
        if (!last || last.lat !== p.lat || last.lng !== p.lng) path.push(p);
      }
    }
  }
  return path.map((p) => ({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) }));
}

(async () => {
  if (!KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const loops: Record<string, GeoPoint[]> = {};
  const commutes: Record<string, { out: GeoPoint[]; back: GeoPoint[] }> = {};
  for (const [name, def] of Object.entries(ABUJA_LOOP_DEFINITIONS)) {
    // A loop ends where it began; the stops along the way are waypoints.
    const [home, ...rest] = def.stops;
    loops[name] = await fetchPath(home, home, rest);
    // Both directions fetched, not one reversed: one-way streets differ.
    commutes[name] = {
      out: await fetchPath(TRT_OFFICE, home),
      back: await fetchPath(home, TRT_OFFICE),
    };
    console.log(
      `${name.padEnd(10)} loop ${loops[name].length} pts · office→hub ${commutes[name].out.length} · hub→office ${commutes[name].back.length}`
    );
  }
  const file = join(__dirname, 'lib', 'abuja-routes.json');
  writeFileSync(file, JSON.stringify({ loops, commutes }));
  console.log(`wrote ${file}`);
})().catch((e) => {
  console.error('build-abuja-routes failed:', (e as Error).message);
  process.exitCode = 1;
});
