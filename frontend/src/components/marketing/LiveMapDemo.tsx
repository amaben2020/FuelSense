'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MAPBOX_TOKEN } from '@/components/maps/ReplayMap3D';
import { GnssTrace } from './GnssTrace';
import { SloshTank } from './SloshTank';
import { LIVE_FIRST_LEG, LIVE_ROUTE, LIVE_ROUTE_KM } from './demo-routes';
import { boundsOf, carElement, pointAt, routeLengths, sliceRoute, useLazyMapbox } from './mapbox-demo';

// A trip on a real map, scrubbed by scroll position.
//
// The drive is sample data on real roads (Gwarinpa → Wuse Market → Garki
// Area 11, geometry in demo-routes.ts). Everything drawn from it is genuine
// product behaviour: the trail builds behind the vehicle, the tank drains
// against distance, and each stop opens to show where the vehicle sat.
//
// Mapbox, not Google: a public page's traffic is nobody's to control, and the
// map is only created when this section is about to scroll into view. Opening
// a stop re-aims the same map instead of loading a second one.

export interface Stop {
  id: string;
  name: string;
  arrived: string;
  minutes: number;
  idleLiters: number;
  /** Fraction along the route, so a stop only lights up once reached. */
  at: number;
}

const STOPS: Stop[] = [
  { id: 'depot', name: 'Depot, Gwarinpa', arrived: '06:12', minutes: 0, idleLiters: 0.1, at: 0 },
  { id: 'market', name: 'Wuse Market', arrived: '06:38', minutes: 14, idleLiters: 0.2, at: LIVE_FIRST_LEG },
  { id: 'client', name: 'Client site, Garki Area 11', arrived: '07:01', minutes: 9, idleLiters: 0.1, at: 1 },
];

const START_LITERS = 42;
/** 17.6 km at the RAV4's 9.8 km/L city rate, plus the idling at the stops. */
const USED_LITERS = 2.2;
const PRICE_PER_LITER = 1300;

export function LiveMapDemo() {
  const root = useRef<HTMLDivElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const carRef = useRef<mapboxgl.Marker | null>(null);
  const stopEls = useRef<HTMLElement[]>([]);
  const [fraction, setFraction] = useState(0);
  const [selected, setSelected] = useState<Stop | null>(null);
  const lengths = useMemo(() => routeLengths(LIVE_ROUTE), []);

  const { map, ready } = useLazyMapbox(
    mapBox,
    { bounds: boundsOf(LIVE_ROUTE), fitBoundsOptions: { padding: 56 }, antialias: true },
    (m) => {
      // Extruded buildings for when a stop is opened close up. Heights come
      // from the style's own tiles, so where there is no data it stays flat.
      const firstSymbol = (m.getStyle().layers ?? []).find((l) => l.type === 'symbol')?.id;
      m.addLayer(
        {
          id: 'demo-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#22262e',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.85,
          },
        },
        firstSymbol
      );
      m.addSource('live-ghost', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: LIVE_ROUTE } },
      });
      m.addLayer({
        id: 'live-ghost',
        type: 'line',
        source: 'live-ghost',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#5a6170', 'line-width': 2, 'line-dasharray': [1.5, 2] },
      });
      m.addSource('live-trail', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [LIVE_ROUTE[0], LIVE_ROUTE[0]] } },
      });
      m.addLayer({
        id: 'live-trail-glow',
        type: 'line',
        source: 'live-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#cde04a', 'line-width': 12, 'line-opacity': 0.16, 'line-blur': 6 },
      });
      m.addLayer({
        id: 'live-trail',
        type: 'line',
        source: 'live-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 4.5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#7f9a26', 1, '#e2f56a'],
        },
      });
      stopEls.current = STOPS.map((stop) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'fs-mapstop';
        el.setAttribute('aria-label', stop.name);
        el.dataset.at = String(stop.at);
        el.addEventListener('click', () => setSelected(stop));
        new mapboxgl.Marker({ element: el }).setLngLat(pointAt(LIVE_ROUTE, lengths, stop.at).at).addTo(m);
        return el;
      });
      carRef.current = new mapboxgl.Marker({ element: carElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(LIVE_ROUTE[0])
        .addTo(m);
    }
  );

  // Scroll drives the trip.
  useEffect(() => {
    const scope = root.current;
    if (!scope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const proxy = { t: 0 };
      gsap.to(proxy, {
        t: 1,
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top 75%', end: 'bottom 55%', scrub: 0.7 },
        onUpdate: () => setFraction(proxy.t),
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  const shown = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : fraction;

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const t = Math.max(shown, 0.002);
    (m.getSource('live-trail') as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: sliceRoute(LIVE_ROUTE, lengths, 0, t) },
    });
    const { at, bearing } = pointAt(LIVE_ROUTE, lengths, t);
    carRef.current?.setLngLat(at).setRotation(bearing);
    for (const el of stopEls.current) el.classList.toggle('is-reached', shown >= Number(el.dataset.at) - 0.001);
  }, [shown, ready, map, lengths]);

  // Opening a stop flies the same map down to it; closing returns to the route.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (selected) {
      m.flyTo({
        center: pointAt(LIVE_ROUTE, lengths, selected.at).at,
        zoom: 16.6,
        pitch: 58,
        bearing: -25,
        duration: 1800,
        essential: true,
      });
    } else {
      m.fitBounds(boundsOf(LIVE_ROUTE), { padding: 56, pitch: 0, bearing: 0, duration: 1400 });
    }
    for (const el of stopEls.current) el.classList.toggle('is-selected', selected != null && el.getAttribute('aria-label') === selected.name);
  }, [selected, ready, map, lengths]);

  if (!MAPBOX_TOKEN) return <GnssTrace />;

  const litersLeft = START_LITERS - USED_LITERS * shown;
  const km = LIVE_ROUTE_KM * shown;
  const spend = Math.round(USED_LITERS * shown * PRICE_PER_LITER);

  return (
    <div className="fs-trace" ref={root}>
      <div className="fs-trace__map">
        <div className="fs-mapframe">
          <div ref={mapBox} className="fs-mapframe__map" />

          <div className="fs-mapbadge">
            <span className="fs-live">
              <span className="fs-live__dot" aria-hidden />
              LAG-001-FS
            </span>
            <span className="fs-mapbadge__sub">Toyota RAV4 · Abuja</span>
          </div>

          {selected && (
            <div className="fs-mapstopcard">
              <div>
                <p className="fs-mapstopcard__name">{selected.name}</p>
                <p className="fs-mapstopcard__meta">
                  {selected.arrived} · {selected.minutes > 0 ? `${selected.minutes} min stop` : 'trip start'} ·{' '}
                  {selected.idleLiters.toFixed(1)} L idling
                </p>
              </div>
              <button type="button" className="fs-mapstopcard__back" onClick={() => setSelected(null)}>
                Back to route
              </button>
            </div>
          )}
        </div>

        <div className="fs-stops">
          {STOPS.map((stop) => (
            <button
              key={stop.id}
              type="button"
              className="fs-stopbtn"
              aria-pressed={selected?.id === stop.id}
              onClick={() => setSelected(selected?.id === stop.id ? null : stop)}
            >
              <span className="fs-stopbtn__name">{stop.name}</span>
              <span className="fs-stopbtn__meta">
                {stop.arrived} · {stop.minutes > 0 ? `${stop.minutes} min` : 'departed'} · {stop.idleLiters.toFixed(1)} L
              </span>
              <span className="fs-stopbtn__cue">{selected?.id === stop.id ? 'Showing · click to close' : 'Fly to this stop'}</span>
            </button>
          ))}
        </div>
      </div>

      <aside className="fs-trace__gauge">
        <p className="fs-trace__gaugelabel">Virtual tank</p>
        <SloshTank fillFraction={litersLeft / START_LITERS} />
        <p className="fs-trace__reading">{litersLeft.toFixed(1)} L</p>

        <p className="fs-trace__gaugelabel" style={{ marginTop: '1.25rem' }}>
          Distance
        </p>
        <p className="fs-trace__reading">{km.toFixed(1)} km</p>

        <p className="fs-trace__gaugelabel" style={{ marginTop: '1.25rem' }}>
          Burn rate
        </p>
        <p className="fs-trace__reading fs-trace__reading--tight">
          {shown > 0.02 ? ((USED_LITERS * shown) / Math.max(km, 0.1)).toFixed(3) : '0.000'} L/km
        </p>

        <p className="fs-trace__gaugelabel" style={{ marginTop: '1.25rem' }}>
          Fuel spent
        </p>
        <p className="fs-trace__reading">₦{spend.toLocaleString('en-NG')}</p>
      </aside>
    </div>
  );
}
