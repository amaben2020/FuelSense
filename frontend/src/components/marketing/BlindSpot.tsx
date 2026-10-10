'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Fuel } from 'lucide-react';

/**
 * The problem, drawn: the four days between two fill-ups.
 *
 * It starts as the manager sees it today, a fogged band with a receipt at each
 * end and nothing in between. Scrolling sweeps light across it and the week
 * appears: each trip, each idle stretch, each stop, with a running tally of
 * what the tracker accounts for. Illustrative week; the categories and the
 * arithmetic are the product's.
 */

type Kind = 'trip' | 'idle' | 'stop';

interface Span {
  from: number;
  to: number;
  kind: Kind;
  label: string;
  km?: number;
  idleMin?: number;
}

const SPANS: Span[] = [
  { from: 0.04, to: 0.13, kind: 'trip', label: 'Mon 08:12 · Gwarinpa → Wuse · 18.4 km', km: 18.4 },
  { from: 0.13, to: 0.16, kind: 'idle', label: 'Engine on at the client gate · 42 min', idleMin: 42 },
  { from: 0.16, to: 0.24, kind: 'trip', label: 'Mon 11:05 · Wuse → Garki · 9.6 km', km: 9.6 },
  { from: 0.3, to: 0.42, kind: 'trip', label: 'Tue · three deliveries · 41.2 km', km: 41.2 },
  { from: 0.42, to: 0.47, kind: 'idle', label: 'Tue 13:20 · waiting at Wuse Market · 1 h 05', idleMin: 65 },
  { from: 0.53, to: 0.66, kind: 'trip', label: 'Wed · Abuja → Kubwa and back · 64.8 km', km: 64.8 },
  { from: 0.72, to: 0.76, kind: 'idle', label: 'Thu · engine on, parked · 48 min', idleMin: 48 },
  { from: 0.76, to: 0.92, kind: 'trip', label: 'Thu · airport run · 92.0 km', km: 92 },
];
const STOPS = [0.13, 0.24, 0.35, 0.39, 0.47, 0.6, 0.66, 0.76, 0.92];
const RATE_KM_L = 9.8;
const IDLE_L_H = 0.9;

export function BlindSpot() {
  const root = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0
  );

  useEffect(() => {
    const scope = root.current;
    if (!scope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const proxy = { t: 0 };
      gsap.to(proxy, {
        t: 1,
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top 70%', end: 'bottom 45%', scrub: 0.6 },
        onUpdate: () => setT(proxy.t),
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  const seen = SPANS.filter((s) => s.from <= t);
  const km = seen.reduce((sum, s) => sum + (s.km ?? 0) * Math.min(1, (t - s.from) / (s.to - s.from)), 0);
  const idleMin = seen.reduce((sum, s) => sum + (s.idleMin ?? 0) * Math.min(1, (t - s.from) / (s.to - s.from)), 0);
  const liters = km / RATE_KM_L + (idleMin / 60) * IDLE_L_H;
  const latest = [...seen].reverse()[0];

  return (
    <div ref={root} className="fs-blind">
      <div className="fs-blind__ends">
        <div className="fs-blind__fill">
          <span className="fs-blind__pump">
            <Fuel className="h-4 w-4" />
          </span>
          <div>
            <p className="fs-blind__filltitle">Fill-up · Mon 07:40</p>
            <p className="fs-blind__fillmeta">NNPC Gwarinpa · 40.0 L · ₦52,000</p>
          </div>
        </div>
        <div className="fs-blind__fill fs-blind__fill--end">
          <div>
            <p className="fs-blind__filltitle">Fill-up · Fri 18:10</p>
            <p className="fs-blind__fillmeta">Total Garki · 38.0 L · ₦49,400</p>
          </div>
          <span className="fs-blind__pump">
            <Fuel className="h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="fs-blind__band" style={{ ['--t' as string]: t }}>
        {/* What a manager has today: nothing between the receipts. */}
        <div className="fs-blind__fog" aria-hidden>
          <span>?</span>
          <span>?</span>
          <span>?</span>
        </div>
        <div className="fs-blind__track">
          {SPANS.map((s) => {
            const p = Math.max(0, Math.min(1, (t - s.from) / (s.to - s.from)));
            return (
              <span
                key={s.from}
                className={`fs-blind__span fs-blind__span--${s.kind}`}
                style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100 * p}%` }}
              />
            );
          })}
          {STOPS.map((at) => (
            <span key={at} className={`fs-blind__stop ${t >= at ? 'is-on' : ''}`} style={{ left: `${at * 100}%` }} />
          ))}
          <span className="fs-blind__sweep" style={{ left: `${t * 100}%` }} aria-hidden />
        </div>
        <div className="fs-blind__days" aria-hidden>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>

      <div className="fs-blind__foot">
        <p className="fs-blind__now" aria-live="polite">
          {latest ? (
            <>
              <i className={`fs-blind__dot fs-blind__dot--${latest.kind}`} />
              {latest.label}
            </>
          ) : (
            'Between the two receipts, nothing on record.'
          )}
        </p>
        <dl className="fs-blind__tally">
          <div>
            <dt>Driven</dt>
            <dd>{km.toFixed(1)} km</dd>
          </div>
          <div>
            <dt>Idling</dt>
            <dd>
              {Math.floor(idleMin / 60)}h {String(Math.round(idleMin % 60)).padStart(2, '0')}m
            </dd>
          </div>
          <div>
            <dt>Modelled burn</dt>
            <dd>{liters.toFixed(1)} L</dd>
          </div>
        </dl>
      </div>
      <div className="fs-blind__legend">
        <span>
          <i className="fs-blind__dot fs-blind__dot--trip" /> Trip
        </span>
        <span>
          <i className="fs-blind__dot fs-blind__dot--idle" /> Engine on, standing still
        </span>
        <span>
          <i className="fs-blind__dot fs-blind__dot--stop" /> Named stop
        </span>
      </div>
    </div>
  );
}
