'use client';

import { useEffect } from 'react';
import type { Customer } from '@/lib/api';
import { useLightTheme } from '@/lib/use-light-theme';

/**
 * A customer's accent, applied to the whole dashboard — in light mode only.
 *
 * `brand_color` used to recolour only the wordmark; every button, active rail
 * item and status chip stayed on FuelSense lemon, so a white-labelled account
 * read as FuelSense with a different name over the door. This derives the
 * tokens the chrome is built from — brand, accent fill and its ink, the dim
 * step, the chart mark, the good-state, the warning and flag tones — from
 * that one hex and writes them
 * onto <html>, where an inline value beats the `.light` declarations in
 * globals.css.
 *
 * Dark mode is left alone on purpose: the lemon on near-black is the
 * product's look and stays the same for every account. An account with no
 * brand colour touches nothing in either theme.
 */
export function BrandTheme({ customer }: { customer: Customer | null }) {
  const light = useLightTheme();
  const brand = customer?.brand_color ?? null;

  useEffect(() => {
    const root = document.documentElement.style;
    const keys = [
      '--brand',
      '--good',
      '--accent-y',
      '--accent-y-dim',
      '--accent-y-ink',
      '--chart-bar',
      '--warn',
      '--warn-deep',
      '--flag',
    ];
    const base = parseHex(brand);
    if (!base || !light) {
      keys.forEach((k) => root.removeProperty(k));
      return;
    }
    const ramp = {
      '--brand': toHex(base),
      '--good': toHex(base),
      '--accent-y': toHex(base),
      '--accent-y-dim': toHex(mix(base, WHITE, 0.2)),
      '--accent-y-ink': '#ffffff',
      '--chart-bar': toHex(mix(base, WHITE, 0.2)),
      // Warnings and flags in a lighter step of the same blue, so a caution
      // banner sits inside the palette instead of arriving in the product's
      // orange next to it.
      '--warn': toHex(mix(base, WHITE, 0.2)),
      '--warn-deep': toHex(base),
      '--flag': toHex(mix(base, WHITE, 0.2)),
    };
    Object.entries(ramp).forEach(([k, v]) => root.setProperty(k, v));
    return () => keys.forEach((k) => root.removeProperty(k));
  }, [brand, light]);

  return null;
}

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];

function parseHex(hex: string | null): Rgb | null {
  if (!hex) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
