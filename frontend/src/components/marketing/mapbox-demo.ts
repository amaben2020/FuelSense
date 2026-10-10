'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '@/components/maps/ReplayMap3D';
import type { LngLat } from './demo-routes';

/**
 * Shared plumbing for the landing page's Mapbox demos.
 *
 * A Mapbox map load is billed, so the map is created only when its section
 * comes near the viewport and never for a visitor who does not scroll there.
 * Scroll-zoom is off: these maps sit in a scrolling page, and a wheel over
 * them must keep moving the page.
 */
export function useLazyMapbox(
  container: React.RefObject<HTMLDivElement | null>,
  options: Omit<mapboxgl.MapOptions, 'container' | 'style'> & { style?: string },
  onLoad: (map: mapboxgl.Map) => void
) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onLoadRef = useRef(onLoad);
  const optionsRef = useRef(options);

  useEffect(() => {
    onLoadRef.current = onLoad;
    optionsRef.current = options;
  });

  useEffect(() => {
    const el = container.current;
    if (!el || !MAPBOX_TOKEN) return;
    let map: mapboxgl.Map | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || map) return;
        io.disconnect();
        mapboxgl.accessToken = MAPBOX_TOKEN;
        const { style, ...rest } = optionsRef.current;
        map = new mapboxgl.Map({
          container: el,
          style: style ?? 'mapbox://styles/mapbox/dark-v11',
          scrollZoom: false,
          attributionControl: true,
          ...rest,
        });
        mapRef.current = map;
        map.on('load', () => {
          onLoadRef.current(map!);
          setReady(true);
        });
      },
      { rootMargin: '300px 0px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, [container]);

  return { map: mapRef, ready };
}

/** Cumulative distance (in degrees, latitude-corrected) along a route. */
export function routeLengths(route: LngLat[]) {
  const out = [0];
  for (let i = 1; i < route.length; i += 1) {
    const [a, b] = [route[i - 1], route[i]];
    const k = Math.cos((b[1] * Math.PI) / 180);
    out.push(out[i - 1] + Math.hypot((b[0] - a[0]) * k, b[1] - a[1]));
  }
  return out;
}

/** Position and compass bearing at fraction `t` of the route. */
export function pointAt(route: LngLat[], lengths: number[], t: number): { at: LngLat; bearing: number } {
  const total = lengths[lengths.length - 1];
  const target = Math.min(Math.max(t, 0), 1) * total;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i += 1;
  const seg = lengths[i] - lengths[i - 1] || 1;
  const f = Math.min(Math.max((target - lengths[i - 1]) / seg, 0), 1);
  const [a, b] = [route[i - 1], route[i]];
  const at: LngLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const k = Math.cos((at[1] * Math.PI) / 180);
  const bearing = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return { at, bearing };
}

/** The part of the route between fractions `from` and `to`. */
export function sliceRoute(route: LngLat[], lengths: number[], from: number, to: number): LngLat[] {
  const total = lengths[lengths.length - 1];
  const out: LngLat[] = [pointAt(route, lengths, from).at];
  for (let i = 1; i < route.length - 1; i += 1) {
    const t = lengths[i] / total;
    if (t > from && t < to) out.push(route[i]);
  }
  out.push(pointAt(route, lengths, to).at);
  return out;
}

export function boundsOf(route: LngLat[]) {
  return route.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(route[0], route[0]));
}

/** A top-down car marker element that turns to a bearing. */
export function carElement() {
  const el = document.createElement('div');
  el.className = 'fs-mapcar';
  el.innerHTML =
    '<span class="fs-mapcar__halo"></span><span class="fs-mapcar__body"><span class="fs-mapcar__glass"></span></span>';
  return el;
}
