'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Clock, Gauge, MapPin, Pause, Play, Route, X } from 'lucide-react';
import { ServerTrip, TripsResponse, api } from '@/lib/api';
import { SnapshotPeriod } from '@/lib/period';
import { MAPBOX_TOKEN } from '@/components/maps/ReplayMap3D';

/**
 * A strip of recent trips, each drawn as its own miniature route.
 *
 * The minis are plain SVG projected from the path `/telemetry/trips` already
 * returns, so a card costs nothing: no tiles, no map load, no geocode. Only
 * the expanded view mounts a Mapbox map, and only while it is open. "Play
 * route" animates the marker along the stored path in the browser, so a
 * replay costs no request at all.
 *
 * No Google Maps anywhere in here, by rule: the minis are SVG, the expanded
 * map is Mapbox, and place names come only from the place cache the trips
 * endpoint already reads. The full replay panel is deliberately not linked,
 * because its 2D view loads the Google Maps JS API.
 */

type TripCard = ServerTrip & {
  key: string;
  vehicleId: string;
  licensePlate: string;
  driverName: string | null;
};

const MAX_CARDS = 8;
const LAGOS = 'Africa/Lagos';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function tripsQuery(period: SnapshotPeriod): string {
  if (period.from && period.to) {
    return `from=${period.from}T00:00:00%2B01:00&to=${period.to}T23:59:59%2B01:00`;
  }
  return `minutes=${Math.min(period.days * 1440, 43200)}`;
}

export function TripMiniCards({ period }: { period: SnapshotPeriod }) {
  const [trips, setTrips] = useState<TripCard[] | null>(null);
  const [open, setOpen] = useState<{ trip: TripCard; from: DOMRect } | null>(null);

  useEffect(() => {
    let live = true;
    api<TripsResponse>(`/telemetry/trips?${tripsQuery(period)}`)
      .then((res) => {
        if (!live) return;
        const all = res.vehicles.flatMap((v) =>
          v.trips.map((t, i) => ({
            ...t,
            key: `${v.vehicle_id}-${t.start_at}-${i}`,
            vehicleId: v.vehicle_id,
            licensePlate: v.license_plate,
            driverName: v.driver_name,
          }))
        );
        setTrips(
          all
            .filter((t) => t.path.length >= 2 && t.distance_km >= 0.5)
            .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
            .slice(0, MAX_CARDS)
        );
      })
      .catch(() => live && setTrips([]));
    return () => {
      live = false;
    };
  }, [period]);

  if (!trips || trips.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-dim">Recent trips</p>
        <p className="text-[11px] text-ink-dim">Tap a route to open it</p>
      </div>
      <div className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {trips.map((trip, i) => (
          <button
            key={trip.key}
            type="button"
            onClick={(e) => setOpen({ trip, from: e.currentTarget.getBoundingClientRect() })}
            className={`group relative w-[156px] shrink-0 snap-start overflow-hidden rounded-xl border border-edge bg-canvas text-left transition duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_8px_24px_-12px_rgba(205,224,74,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              open?.trip.key === trip.key ? 'opacity-0' : ''
            }`}
          >
            <MiniRoute path={trip.path} delay={i * 0.07} className="h-[92px] w-full" />
            <div className="border-t border-edge px-2.5 py-2">
              <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                {trip.distance_km.toFixed(1)} km
              </p>
              <p className="truncate text-[11px] text-ink-dim">
                {shortWhen(trip.start_at)} · {trip.licensePlate}
              </p>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <TripExpanded
          trip={open.trip}
          from={open.from}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- mini route

/** Equirectangular with the longitude squeezed by cos(lat): accurate enough at city scale. */
function projectPath(path: [number, number][], w: number, h: number, pad: number) {
  const lats = path.map((p) => p[0]);
  const lngs = path.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = lngs.map((l) => l * k);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  return path.map((_, i) => [ox + (xs[i] - minX) * scale, oy + (maxY - lats[i]) * scale] as const);
}

function MiniRoute({
  path,
  delay = 0,
  className = '',
  big = false,
}: {
  path: [number, number][];
  delay?: number;
  className?: string;
  big?: boolean;
}) {
  const W = 160;
  const H = 96;
  const pts = useMemo(() => projectPath(path, W, H, big ? 10 : 14), [path, big]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const animate = !reducedMotion();
  const gid = `r${useId().replace(/:/g, '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      <defs>
        <pattern id={`${gid}-grid`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-ink/10" />
        </pattern>
        <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8fa82e" />
          <stop offset="100%" stopColor="#d4ec4f" />
        </linearGradient>
        <filter id={`${gid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect width={W} height={H} fill={`url(#${gid}-grid)`} />
      <path d={d} fill="none" stroke="#cde04a" strokeOpacity="0.35" strokeWidth="4" filter={`url(#${gid}-glow)`}
        pathLength={1} strokeDasharray="1" strokeDashoffset={animate ? 1 : 0}
        style={animate ? { animation: `fs-route-draw 1.1s cubic-bezier(.65,0,.35,1) ${delay}s forwards` } : undefined} />
      <path d={d} fill="none" stroke={`url(#${gid}-line)`} strokeWidth={big ? 1.6 : 2} strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} strokeDasharray="1" strokeDashoffset={animate ? 1 : 0}
        style={animate ? { animation: `fs-route-draw 1.1s cubic-bezier(.65,0,.35,1) ${delay}s forwards` } : undefined} />
      <circle cx={sx} cy={sy} r="2.6" fill="#0b0d10" stroke="#cde04a" strokeWidth="1.2" />
      <circle cx={ex} cy={ey} r="3" fill="#cde04a"
        style={animate ? { opacity: 0, animation: `fs-fade-in .3s ease ${delay + 1}s forwards` } : undefined} />
      <style>{`@keyframes fs-route-draw{to{stroke-dashoffset:0}}@keyframes fs-fade-in{to{opacity:1}}`}</style>
    </svg>
  );
}

// ---------------------------------------------------------------- expanded

function TripExpanded({
  trip,
  from,
  onClose,
}: {
  trip: TripCard;
  from: DOMRect;
  onClose: () => void;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const routeLayer = useRef<HTMLDivElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const playFrame = useRef(0);
  const closing = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const coords = useMemo(() => trip.path.map(([lat, lng]) => [lng, lat] as [number, number]), [trip.path]);
  const cumulative = useMemo(() => {
    const out = [0];
    for (let i = 1; i < coords.length; i += 1) {
      const [a, b] = [coords[i - 1], coords[i]];
      out.push(out[i - 1] + Math.hypot((b[0] - a[0]) * Math.cos((b[1] * Math.PI) / 180), b[1] - a[1]));
    }
    return out;
  }, [coords]);

  const mountMap = useCallback(() => {
    if (!MAPBOX_TOKEN || !mapBox.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    const map = new mapboxgl.Map({
      container: mapBox.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      bounds,
      fitBoundsOptions: { padding: 60 },
      pitch: 35,
      attributionControl: true,
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('trip', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      });
      map.addLayer({
        id: 'trip-glow',
        type: 'line',
        source: 'trip',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#cde04a', 'line-width': 12, 'line-opacity': 0.18, 'line-blur': 6, 'line-trim-offset': [0, 1] },
      });
      map.addLayer({
        id: 'trip-line',
        type: 'line',
        source: 'trip',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 4.5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#7f9a26', 1, '#e2f56a'],
          'line-trim-offset': [0, 1],
        },
      });
      const el = document.createElement('div');
      el.style.cssText =
        'width:16px;height:16px;border-radius:50%;background:#cde04a;border:2px solid #0b1220;box-shadow:0 0 0 6px rgba(205,224,74,.2),0 0 18px rgba(205,224,74,.6)';
      markerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);

      setMapReady(true);
      if (routeLayer.current) gsap.to(routeLayer.current, { opacity: 0, duration: 0.5, ease: 'power2.out' });
      // The route draws itself along the road.
      const t0 = performance.now();
      const dur = reducedMotion() ? 0 : 1400;
      const draw = (now: number) => {
        const p = dur ? Math.min((now - t0) / dur, 1) : 1;
        const eased = 1 - Math.pow(1 - p, 3);
        if (!mapRef.current) return;
        map.setPaintProperty('trip-line', 'line-trim-offset', [eased, 1]);
        map.setPaintProperty('trip-glow', 'line-trim-offset', [eased, 1]);
        if (p < 1) requestAnimationFrame(draw);
        else {
          map.setPaintProperty('trip-line', 'line-trim-offset', [0, 0]);
          map.setPaintProperty('trip-glow', 'line-trim-offset', [0, 0]);
        }
      };
      requestAnimationFrame(draw);
    });
  }, [coords]);

  // Shared-element open: the panel starts exactly where the card was and grows
  // into place, then the detail rises in. The SVG route scales cleanly during
  // the morph; the map is mounted only once the panel has settled.
  useLayoutEffect(() => {
    const el = panel.current;
    const bg = backdrop.current;
    if (!el || !bg) return;
    if (reducedMotion()) {
      mountMap();
      return;
    }
    const to = el.getBoundingClientRect();
    const tl = gsap.timeline({ onComplete: mountMap });
    tl.fromTo(bg, { opacity: 0, backdropFilter: 'blur(0px)' }, { opacity: 1, backdropFilter: 'blur(10px)', duration: 0.45, ease: 'power2.out' }, 0)
      .fromTo(
        el,
        {
          x: from.left - to.left,
          y: from.top - to.top,
          scaleX: from.width / to.width,
          scaleY: from.height / to.height,
          borderRadius: 12,
          transformOrigin: '0 0',
        },
        { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 20, duration: 0.75, ease: 'expo.inOut' },
        0
      )
      .fromTo(el.querySelectorAll('[data-rise]'), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }, 0.5);
    return () => {
      tl.kill();
    };
    // Open once, from where the card was; `from` never changes for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(playFrame.current);
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    cancelAnimationFrame(playFrame.current);
    const el = panel.current;
    const bg = backdrop.current;
    if (!el || !bg || reducedMotion()) return onClose();
    const to = el.getBoundingClientRect();
    if (routeLayer.current) gsap.set(routeLayer.current, { opacity: 1 });
    gsap
      .timeline({ onComplete: onClose })
      .to(el.querySelectorAll('[data-rise]'), { opacity: 0, duration: 0.15 }, 0)
      .to(
        el,
        {
          x: from.left - to.left,
          y: from.top - to.top,
          scaleX: from.width / to.width,
          scaleY: from.height / to.height,
          borderRadius: 12,
          transformOrigin: '0 0',
          duration: 0.55,
          ease: 'expo.inOut',
        },
        0.05
      )
      .to(bg, { opacity: 0, duration: 0.4 }, 0.15);
  }, [from, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Client-side route playback: the marker travels the stored path at a pace
  // proportional to distance. No request, so it is free to repeat.
  const togglePlay = () => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (playing) {
      cancelAnimationFrame(playFrame.current);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const total = cumulative[cumulative.length - 1] || 1;
    const durationMs = Math.min(Math.max(trip.distance_km * 350, 6000), 16000);
    const startP = progress >= 1 ? 0 : progress;
    const t0 = performance.now() - startP * durationMs;
    let lastCam = 0;
    const step = (now: number) => {
      const p = Math.min((now - t0) / durationMs, 1);
      const target = p * total;
      let i = 1;
      while (i < cumulative.length - 1 && cumulative[i] < target) i += 1;
      const seg = cumulative[i] - cumulative[i - 1] || 1;
      const f = Math.min(Math.max((target - cumulative[i - 1]) / seg, 0), 1);
      const [a, b] = [coords[i - 1], coords[i]];
      const pos: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      marker.setLngLat(pos);
      if (now - lastCam > 400) {
        map.easeTo({ center: pos, duration: 450, easing: (t) => t });
        lastCam = now;
      }
      setProgress(p);
      if (p < 1) playFrame.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    playFrame.current = requestAnimationFrame(step);
  };

  const origin = trip.stops.find((s) => s.kind === 'origin')?.place_label;
  const destination = trip.stops.find((s) => s.kind === 'destination')?.place_label;
  const stopCount = trip.stops.filter((s) => s.kind === 'stop').length;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-6">
      <div ref={backdrop} className="absolute inset-0 bg-black/60" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-label={`Trip of ${trip.distance_km.toFixed(1)} km`}
        className="relative flex h-[min(760px,92vh)] w-[min(1100px,100%)] flex-col overflow-hidden rounded-[20px] border border-edge bg-canvas shadow-2xl will-change-transform md:flex-row"
      >
        <div className="relative min-h-[46%] flex-1 bg-[#0b0d10]">
          {/* mapbox-gl's stylesheet sets position:relative on its container,
              which would cancel absolute positioning, so it gets an inner box. */}
          <div className="absolute inset-0">
            <div ref={mapBox} className="h-full w-full" />
          </div>
          <div ref={routeLayer} className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <MiniRoute path={trip.path} big className="h-full w-full" />
          </div>
          {!MAPBOX_TOKEN && (
            <p className="absolute bottom-3 left-3 text-[11px] text-ink-dim">Map view needs NEXT_PUBLIC_MAPBOX_PK.</p>
          )}
          {mapReady && (
            <div className="absolute bottom-10 left-4 right-4 flex items-center gap-3 rounded-full border border-edge bg-canvas/80 px-2 py-1.5 backdrop-blur-md">
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-canvas transition hover:scale-105"
                aria-label={playing ? 'Pause route' : 'Play route'}
              >
                {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
              </button>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="pr-2 font-mono text-[11px] tabular-nums text-ink-dim">
                {(trip.distance_km * progress).toFixed(1)} / {trip.distance_km.toFixed(1)} km
              </span>
            </div>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-edge p-5 md:w-[320px] md:border-l md:border-t-0">
          <div data-rise className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                {trip.licensePlate}
                {trip.driverName ? ` · ${trip.driverName}` : ''}
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-ink">
                {trip.distance_km.toFixed(1)} <span className="text-lg font-semibold text-ink-mid">km</span>
              </p>
              <p className="mt-1 text-sm text-ink-mid">{longWhen(trip.start_at, trip.end_at)}</p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-2 text-ink-dim hover:bg-ink/5 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl data-rise className="grid grid-cols-2 gap-3">
            <Stat icon={Clock} label="Duration" value={formatMinutes(trip.duration_minutes)} />
            <Stat icon={Gauge} label="Avg / max" value={`${Math.round(trip.avg_speed_kph)} / ${Math.round(trip.max_speed_kph)} km/h`} />
            <Stat icon={MapPin} label="Stops" value={String(stopCount)} />
            <Stat icon={Route} label="Engine idling" value={formatMinutes(trip.idle_minutes)} />
          </dl>

          {(origin || destination) && (
            <ol data-rise className="space-y-2 border-t border-edge pt-4 text-sm">
              {origin && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-accent" />
                  <span className="text-ink-mid">{origin}</span>
                </li>
              )}
              {destination && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span className="text-ink-mid">{destination}</span>
                </li>
              )}
            </ol>
          )}

        </aside>
      </div>
    </div>,
    document.body
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        <Icon className="h-3 w-3" /> {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function formatMinutes(min: number) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function shortWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LAGOS,
  });
}

function longWhen(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: LAGOS });
  const t = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LAGOS });
  return `${day}, ${t(s)}–${t(e)}`;
}
