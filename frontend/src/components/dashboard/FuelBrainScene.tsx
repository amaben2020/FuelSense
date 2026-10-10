'use client';

import { useMemo } from 'react';
import { Brain } from 'lucide-react';

/**
 * FuelBrain's welcome mark: a car driving a loop through a small city while
 * the brain above it watches, a radar sweep passing over the streets.
 *
 * Everything is inline SVG and CSS, so it costs no map load and no request
 * (no Google, no Mapbox tiles). The car rides the route with SVG
 * animateMotion; each waypoint lights up at the moment the car reaches it,
 * timed from the route's own segment lengths so the two never drift apart.
 * While an answer is being worked out the sweep and the brain speed up.
 */

const ROUTE: [number, number][] = [
  [46, 62],
  [146, 62],
  [146, 104],
  [104, 104],
  [104, 148],
  [58, 148],
  [46, 120],
];
const LAP_SECONDS = 10;
/** Indexes into ROUTE that carry a waypoint, and what it is. */
const WAYPOINTS: { at: number; kind: 'fuel' | 'stop' | 'depot' }[] = [
  { at: 1, kind: 'fuel' },
  { at: 4, kind: 'stop' },
  { at: 0, kind: 'depot' },
];

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function FuelBrainScene({ thinking = false, size = 176 }: { thinking?: boolean; size?: number }) {
  const { d, fractions } = useMemo(() => {
    const pts = [...ROUTE, ROUTE[0]];
    const lens = [0];
    for (let i = 1; i < pts.length; i += 1) {
      lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = lens[lens.length - 1];
    return {
      d: `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`,
      fractions: lens.map((l) => l / total),
    };
  }, []);
  const animate = !reducedMotion();

  return (
    <div className={`fb-scene ${thinking ? 'is-thinking' : ''}`} style={{ width: size, height: size + 22 }} aria-hidden>
      {/* The brain, hovering over the lens with a pulse. */}
      <div className="fb-scene__brain">
        <span className="fb-scene__pulse" />
        <span className="fb-orb__core h-11 w-11">
          <Brain className="h-5 w-5" />
        </span>
      </div>

      <div className="fb-scene__lens" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" className="h-full w-full">
          <defs>
            <radialGradient id="fbs-bg" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#171a20" />
              <stop offset="100%" stopColor="#0c0e12" />
            </radialGradient>
            <linearGradient id="fbs-route" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8fa82e" />
              <stop offset="100%" stopColor="#e2f56a" />
            </linearGradient>
            <radialGradient id="fbs-beam" cx="0%" cy="50%" r="100%">
              <stop offset="0%" stopColor="#fff8c4" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#fff8c4" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="200" height="200" fill="url(#fbs-bg)" />

          {/* City blocks */}
          {[
            [22, 22, 60, 26], [100, 22, 78, 26], [22, 76, 70, 34], [118, 76, 60, 14],
            [118, 116, 60, 62], [22, 116, 62, 18], [22, 162, 70, 22], [70, 116, 22, 18],
          ].map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx="4" fill="#1a1e25" stroke="#22262e" strokeWidth="0.6" />
          ))}
          {/* A river, so the map reads as a place rather than a grid */}
          <path d="M-5 186 C40 170 70 196 110 186 S170 160 205 172" fill="none" stroke="#1d3a55" strokeWidth="7" strokeLinecap="round" opacity="0.65" />

          {/* Streets with lane dashes */}
          <g stroke="#262a32" strokeWidth="9" strokeLinecap="round">
            <path d="M10 62 H190 M10 104 H190 M10 148 H190 M46 10 V190 M104 10 V190 M146 10 V190" />
          </g>
          <g stroke="#3a3f48" strokeWidth="0.8" strokeDasharray="3 4">
            <path d="M10 62 H190 M10 104 H190 M10 148 H190 M46 10 V190 M104 10 V190 M146 10 V190" />
          </g>

          {/* The route and a trail that chases the car */}
          <path d={d} fill="none" stroke="#cde04a" strokeOpacity="0.16" strokeWidth="6" strokeLinejoin="round" />
          <path
            d={d}
            fill="none"
            stroke="url(#fbs-route)"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="22 78"
            className={animate ? 'fb-scene__trail' : undefined}
            style={{ animationDuration: `${LAP_SECONDS}s` }}
          />

          {/* Waypoints flash as the car reaches them */}
          {WAYPOINTS.map(({ at, kind }) => {
            const [x, y] = ROUTE[at];
            const t = fractions[at];
            const color = kind === 'fuel' ? '#f0a63a' : kind === 'stop' ? '#5fb3ff' : '#cde04a';
            return (
              <g key={at}>
                <circle cx={x} cy={y} r="4.2" fill="#0c0e12" stroke={color} strokeWidth="1.6" />
                {animate && (
                  <circle cx={x} cy={y} r="4" fill="none" stroke={color} strokeWidth="1.5" opacity="0">
                    <animate
                      attributeName="r"
                      dur={`${LAP_SECONDS}s`}
                      repeatCount="indefinite"
                      values="4;4;16;16"
                      keyTimes={`0;${t.toFixed(3)};${Math.min(t + 0.08, 0.999).toFixed(3)};1`}
                    />
                    <animate
                      attributeName="opacity"
                      dur={`${LAP_SECONDS}s`}
                      repeatCount="indefinite"
                      values="0;0.9;0;0"
                      keyTimes={`0;${t.toFixed(3)};${Math.min(t + 0.08, 0.999).toFixed(3)};1`}
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* The car: top-down body, cabin glass, headlight beam */}
          <g>
            <g transform="scale(1.5) translate(-7.5 -4.5)">
              <path d="M14.5 2 L25 -2 L25 11 L14.5 7 Z" fill="url(#fbs-beam)" />
              <rect x="0.5" y="0.8" width="15" height="9" rx="3" fill="#000" opacity="0.35" />
              <rect width="15" height="9" rx="3" fill="#cde04a" />
              <rect x="8.5" y="1.4" width="4" height="6.2" rx="1.2" fill="#0c0e12" opacity="0.75" />
              <rect x="2" y="1.6" width="3" height="5.8" rx="1" fill="#0c0e12" opacity="0.45" />
              <rect x="13.6" y="1" width="1.4" height="2" rx="0.5" fill="#fff8c4" />
              <rect x="13.6" y="6" width="1.4" height="2" rx="0.5" fill="#fff8c4" />
            </g>
            {animate ? (
              <animateMotion dur={`${LAP_SECONDS}s`} repeatCount="indefinite" rotate="auto" path={d} />
            ) : (
              <animateMotion dur="0.01s" fill="freeze" rotate="auto" path={d} keyPoints="0.1;0.1" keyTimes="0;1" calcMode="linear" />
            )}
          </g>
        </svg>

        {/* The brain's radar passing over the streets */}
        <span className="fb-scene__sweep" />
        <span className="fb-scene__vignette" />
      </div>
    </div>
  );
}
