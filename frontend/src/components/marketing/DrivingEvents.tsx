'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BEHAVIOUR_ROUTE, BEHAVIOUR_ROUTE_KM } from './demo-routes';
import { boundsOf, carElement, pointAt, routeLengths, sliceRoute, useLazyMapbox } from './mapbox-demo';

// The driving-events panel, built to look and behave like the product.
//
// The previous version was an abstract curve on an empty ground: no map, no
// vehicle, no event names. A visitor could not tell what they were looking at,
// which defeats the point of the section — someone deciding whether this solves
// their problem needs to see the actual instrument, not a diagram of one.
//
// So this is the replay panel in miniature: a real Abuja road on a Mapbox
// map (Life Camp to Maitama, geometry committed in demo-routes.ts), the
// vehicle driving it as you scroll, a track coloured by measured speed with
// manoeuvre stretches picked out, and the event feed ticking alongside it.
//
// **The telemetry below is a scripted demonstration, not a live feed**, and the
// panel says so on its face. Everything it depicts is real capability — the
// speeds, the magnitudes, the detection thresholds and the derivation method
// all match what `harsh-driving.ts` actually computes — but these particular
// numbers describe a drive that never happened. Labelling it clearly is the
// same standard the product itself is held to.

type Tone = 'slow' | 'mid' | 'fast' | 'brake' | 'corner' | 'over';

const TONE: Record<Tone, string> = {
  slow: '#4d7c3f',
  mid: '#8fb840',
  fast: '#cde04a',
  brake: '#ff4d4f',
  corner: '#ffab00',
  over: '#ff36c0',
};

/** Contiguous stretches of the route, in travel order. */
const SEGMENTS: Array<{ from: number; to: number; tone: Tone }> = [
  { from: 0, to: 0.13, tone: 'slow' },
  { from: 0.13, to: 0.25, tone: 'mid' },
  { from: 0.25, to: 0.31, tone: 'brake' },
  { from: 0.31, to: 0.44, tone: 'mid' },
  { from: 0.44, to: 0.51, tone: 'corner' },
  { from: 0.51, to: 0.64, tone: 'fast' },
  { from: 0.64, to: 0.84, tone: 'over' },
  { from: 0.84, to: 1, tone: 'mid' },
];

interface Event {
  /** Fraction along the route where it fires. */
  at: number;
  clock: string;
  type: string;
  detail: string;
  /** How it is known — never omitted. */
  source: string;
  tone: Tone;
}

const EVENTS: Event[] = [
  {
    at: 0.13,
    clock: '07:12:04',
    type: 'Trip started',
    detail: 'Ignition ON · Depot, Life Camp',
    source: 'AVL 239 ignition edge',
    tone: 'mid',
  },
  {
    at: 0.29,
    clock: '07:19:41',
    type: 'Harsh braking',
    detail: '4.1 m/s² · 0.42 g · from 63 km/h',
    source: 'Derived from the GPS speed trace',
    tone: 'brake',
  },
  {
    at: 0.5,
    clock: '07:24:18',
    type: 'Harsh cornering',
    detail: '3.6 m/s² lateral at 51 km/h',
    source: 'Speed × rate of heading change',
    tone: 'corner',
  },
  {
    at: 0.72,
    clock: '07:31:55',
    type: 'Overspeeding',
    detail: '118 km/h peak · 1 min 40 s over',
    source: 'Measured speed vs your 100 km/h limit',
    tone: 'over',
  },
  {
    at: 0.92,
    clock: '07:38:22',
    type: 'Idling',
    detail: '6 min 12 s · 0.12 L · ₦156',
    source: 'Engine on, speed below 2 km/h',
    tone: 'slow',
  },
];

/** How loud each event is in the log. */
const SEVERITY: Record<Tone, 'High' | 'Medium' | 'Low' | 'Info'> = {
  brake: 'High',
  over: 'High',
  corner: 'Medium',
  slow: 'Low',
  mid: 'Info',
  fast: 'Info',
};

/** Live readout beside the map, interpolated as the scrubber moves. */
function readoutAt(t: number) {
  const speed = Math.round(
    t < 0.13 ? 18 + t * 120 : t < 0.31 ? 63 - (t - 0.13) * 90 : t < 0.64 ? 48 + (t - 0.31) * 70 : t < 0.84 ? 118 - (t - 0.64) * 40 : 26
  );
  return {
    speed: Math.max(0, speed),
    distance: (t * BEHAVIOUR_ROUTE_KM).toFixed(1),
    fuel: (39.7 - t * 2.38).toFixed(1),
    spent: Math.round(t * 3050).toLocaleString('en-NG'),
  };
}

/**
 * The behaviours a visitor can inspect, one at a time.
 *
 * Showing all four colours at once made the track look like a fault report on
 * a single catastrophic drive, and buried the thing each detection actually
 * demonstrates. Picking one keeps the other stretches on the track as measured
 * speed, so the selected behaviour reads as an exception against normal
 * driving, which is how it appears in the product.
 */
const BEHAVIOURS: Array<{ id: Tone | 'all'; label: string; blurb: string }> = [
  {
    id: 'all',
    label: 'Everything',
    blurb: 'One drive, every detection the tracker supports, in the order they fired.',
  },
  {
    id: 'brake',
    label: 'Harsh braking',
    blurb: 'Δspeed ÷ Δt across consecutive fixes. Flagged past 3.0 m/s².',
  },
  {
    id: 'corner',
    label: 'Harsh cornering',
    blurb: 'Speed × rate of heading change. Ignored below 15 km/h, where heading is noise.',
  },
  {
    id: 'over',
    label: 'Overspeeding',
    blurb: 'Measured speed against the limit you declare. No limit set means nothing is reported.',
  },
];

export function DrivingEvents() {
  const root = useRef<HTMLDivElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const carRef = useRef<mapboxgl.Marker | null>(null);
  const pinsRef = useRef<HTMLElement[]>([]);
  // Reduced motion gets the finished picture: the section is information,
  // and the scrubbing is only its delivery.
  const [progress, setProgress] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0
  );
  const [behaviour, setBehaviour] = useState<Tone | 'all'>('all');
  const lengths = useMemo(() => routeLengths(BEHAVIOUR_ROUTE), []);

  /** The coloured track up to the car, honouring the selected behaviour. */
  const trackData = useCallback(
    (t: number, pick: Tone | 'all'): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: SEGMENTS.filter((seg) => seg.from < t).map((seg) => {
        const isManoeuvre = seg.tone === 'brake' || seg.tone === 'corner' || seg.tone === 'over';
        // A manoeuvre the visitor is not inspecting falls back to its speed
        // colour, so the track stays a complete drive rather than gaining gaps.
        const muted = isManoeuvre && pick !== 'all' && pick !== seg.tone;
        return {
          type: 'Feature',
          properties: { color: TONE[muted ? 'mid' : seg.tone], width: isManoeuvre && !muted ? 7 : 4.5 },
          geometry: { type: 'LineString', coordinates: sliceRoute(BEHAVIOUR_ROUTE, lengths, seg.from, Math.min(seg.to, t)) },
        };
      }),
    }),
    [lengths]
  );

  const { map, ready } = useLazyMapbox(
    mapBox,
    { bounds: boundsOf(BEHAVIOUR_ROUTE), fitBoundsOptions: { padding: { top: 70, bottom: 40, left: 40, right: 40 } }, pitch: 38, bearing: -8 },
    (m) => {
      m.addSource('drive-ghost', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: BEHAVIOUR_ROUTE } },
      });
      m.addLayer({
        id: 'drive-ghost',
        type: 'line',
        source: 'drive-ghost',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b0e13', 'line-width': 10, 'line-opacity': 0.9 },
      });
      m.addLayer({
        id: 'drive-ghost-dash',
        type: 'line',
        source: 'drive-ghost',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3a3f48', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });
      m.addSource('drive-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'drive-track',
        type: 'line',
        source: 'drive-track',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      });
      pinsRef.current = EVENTS.filter((e) => e.tone !== 'mid' && e.tone !== 'slow').map((e) => {
        const el = document.createElement('div');
        el.className = 'fs-mappin';
        el.style.setProperty('--pin', TONE[e.tone]);
        el.dataset.at = String(e.at);
        el.dataset.tone = e.tone;
        new mapboxgl.Marker({ element: el }).setLngLat(pointAt(BEHAVIOUR_ROUTE, lengths, e.at).at).addTo(m);
        return el;
      });
      carRef.current = new mapboxgl.Marker({ element: carElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(BEHAVIOUR_ROUTE[0])
        .addTo(m);
    }
  );

  // Scroll drives the drive.
  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    gsap.registerPlugin(ScrollTrigger);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      const proxy = { t: 0 };
      gsap.to(proxy, {
        t: 1,
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top 75%', end: 'bottom 60%', scrub: 0.6 },
        onUpdate: () => setProgress(proxy.t),
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  // Paint the frame: track, car, pins.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('drive-track') as mapboxgl.GeoJSONSource | undefined)?.setData(trackData(progress, behaviour));
    const { at, bearing } = pointAt(BEHAVIOUR_ROUTE, lengths, Math.max(progress, 0.001));
    carRef.current?.setLngLat(at).setRotation(bearing);
    for (const pin of pinsRef.current) {
      const shown = progress >= Number(pin.dataset.at) && (behaviour === 'all' || behaviour === pin.dataset.tone);
      pin.classList.toggle('is-on', shown);
    }
  }, [progress, behaviour, ready, map, trackData, lengths]);

  const live = readoutAt(progress);
  // "Everything" keeps the trip bookends for context; a single behaviour shows
  // only its own occurrences, so the feed matches what the track is drawing.
  const shownEvents =
    behaviour === 'all' ? EVENTS : EVENTS.filter((e) => e.tone === behaviour);
  const fired = shownEvents.filter((e) => progress >= e.at);

  return (
    <div ref={root} className="fs-events">
      <div className="fs-events__picker">
        <div className="fs-events__tabs" role="tablist" aria-label="Driving behaviour">
          {BEHAVIOURS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={behaviour === b.id}
              onClick={() => setBehaviour(b.id)}
              className={`fs-events__tab${behaviour === b.id ? ' is-active' : ''}`}
            >
              {b.id !== 'all' && (
                <span
                  className="fs-events__tabdot"
                  style={{ background: TONE[b.id as Tone] }}
                  aria-hidden="true"
                />
              )}
              {b.label}
            </button>
          ))}
        </div>
        {/* How the selected behaviour is actually computed. The point of the
            section is that each detection is checkable, so the method travels
            with the tab rather than living in a footnote. */}
        <p className="fs-events__blurb">
          {BEHAVIOURS.find((b) => b.id === behaviour)?.blurb}
        </p>
      </div>

      <div className="fs-events__stage">
        <div className="fs-events__chip">
          <span className="fs-events__dot" />
          LAG-001-FS · Toyota RAV4 · Life Camp → Maitama
        </div>

        <div ref={mapBox} className="fs-events__map" role="img" aria-label="A drive from Life Camp to Maitama, coloured by measured speed, with harsh braking, harsh cornering and an overspeed stretch marked" />

        <div className="fs-events__legend">
          <span className="fs-events__key">
            <span className="fs-events__swatch fs-events__swatch--ramp" aria-hidden="true" />
            Measured speed
          </span>
          {(['brake', 'corner', 'over'] as const).map((tone) => (
            <span key={tone} className="fs-events__key">
              <span
                className="fs-events__swatch"
                style={{ background: TONE[tone] }}
                aria-hidden="true"
              />
              {tone === 'brake' ? 'Harsh braking' : tone === 'corner' ? 'Harsh cornering' : 'Over the limit'}
            </span>
          ))}
        </div>
      </div>

      <div className="fs-events__side">
        {/* Live readout — the same four figures the product puts beside a trip. */}
        <div className="fs-events__readout">
          {[
            { label: 'Speed', value: `${live.speed}`, unit: 'km/h' },
            { label: 'Distance', value: live.distance, unit: 'km' },
            { label: 'Tank (modelled)', value: live.fuel, unit: 'L' },
            { label: 'Fuel spent', value: `₦${live.spent}`, unit: '' },
          ].map((m) => (
            <div key={m.label} className="fs-events__metric">
              <p className="fs-events__metriclabel">{m.label}</p>
              <p className="fs-events__metricvalue">
                {m.value}
                {m.unit && <span className="fs-events__metricunit"> {m.unit}</span>}
              </p>
            </div>
          ))}
        </div>

        <div className="fs-log">
          <div className="fs-log__head">
            <span className="fs-log__live" aria-hidden />
            <span className="fs-log__title">Live stream</span>
            <span className="fs-log__conn">
              <i /> connected · {Math.round(38 + Math.abs(Math.sin(progress * 47)) * 41)} ms
            </span>
            <span className="fs-log__count">{fired.length} msgs</span>
          </div>
          <ol className="fs-log__list" aria-live="polite">
            {fired.length < shownEvents.length && (
              <li className="fs-log__listen">
                <span className="fs-log__dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                Listening for the next event…
              </li>
            )}
            {[...fired].reverse().map((e, i) => {
              const sev = SEVERITY[e.tone];
              return (
                <li
                  key={e.type}
                  className={`fs-log__item is-live ${i === 0 ? 'is-newest' : ''}`}
                  style={{ ['--tone' as string]: TONE[e.tone] }}
                >
                  <time className="fs-log__time">{e.clock}</time>
                  <span className="fs-log__node" aria-hidden />
                  <div className="fs-log__body">
                    <div className="fs-log__row">
                      <span className="fs-log__type">{e.type}</span>
                      <span className={`fs-log__sev fs-log__sev--${sev.toLowerCase()}`}>{sev}</span>
                    </div>
                    <div className="fs-log__chips">
                      {e.detail.split(' · ').map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                    <p className="fs-log__method">
                      <span>Method</span> {e.source}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="fs-events__disclaimer">
          Scripted demonstration, not a live vehicle. The detection method,
          thresholds and units are the ones the product actually uses — this
          particular drive is not real.
        </p>
      </div>
    </div>
  );
}
