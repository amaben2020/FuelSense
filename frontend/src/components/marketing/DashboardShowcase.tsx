'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Bell,
  Brain,
  Car,
  Fuel,
  Gauge,
  LayoutGrid,
  MapPin,
  ReceiptText,
  Route,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

/**
 * The dashboard a manager lands on, rebuilt in code at full fidelity.
 *
 * It tilts up out of the page as it scrolls in, and four numbered hotspots
 * name what each part is for; hovering a note lights its region. Figures are
 * a sample week, laid out exactly as the product lays them out.
 */

const NOTES = [
  { n: 1, area: 'receipts', title: 'Receipts lead', body: 'The headline is money actually paid at the pump. The modelled burn is one toggle away.' },
  { n: 2, area: 'trips', title: 'Every trip, a route', body: 'Recent trips as miniature routes. Open one for the map, the stops, the driver and a replay.' },
  { n: 3, area: 'health', title: 'A score that explains itself', body: 'Fleet health and preventable loss, each broken down into the alerts and minutes behind it.' },
  { n: 4, area: 'brain', title: 'Ask, don’t dig', body: 'FuelBrain answers questions over the same data, with the figures and a chart.' },
] as const;

type Area = (typeof NOTES)[number]['area'];

const BARS = [0, 0, 26, 0, 0, 0, 0, 40, 0, 0, 0, 52, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 44, 0, 0, 0, 34, 0, 0, 0];
const ROUTES = [
  'M6 40 C 20 34, 26 18, 44 20 S 64 8, 74 10',
  'M8 12 C 18 26, 30 30, 38 22 S 60 36, 72 40',
  'M10 38 L 22 30 L 30 34 L 44 16 L 58 22 L 70 8',
];

export function DashboardShowcase() {
  const root = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Area | null>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-dw]',
        { rotateX: 24, scale: 0.9, y: 60, opacity: 0.4 },
        {
          rotateX: 0,
          scale: 1,
          y: 0,
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: scope, start: 'top 90%', end: 'top 25%', scrub: 0.8 },
        }
      );
      gsap.from('[data-dw-pin]', {
        scale: 0,
        duration: 0.5,
        stagger: 0.12,
        ease: 'back.out(2)',
        scrollTrigger: { trigger: scope, start: 'top 30%', once: true },
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  const zone = (a: Area) => `fs-dw__zone ${focus === a ? 'is-focus' : ''} ${focus && focus !== a ? 'is-dim' : ''}`;
  const pin = (n: number, a: Area) => (
    <span className="fs-dw__pin" data-dw-pin onMouseEnter={() => setFocus(a)} onMouseLeave={() => setFocus(null)}>
      {n}
    </span>
  );

  return (
    <div ref={root} className="fs-dw">
      <div className="fs-dw__persp">
        <div className="fs-dw__win" data-dw role="img" aria-label="The FuelSense operations dashboard">
          <aside className="fs-dw__rail" aria-hidden>
            <span className="fs-dw__logo" />
            {[LayoutGrid, MapPin, Car, Route, ShieldCheck, Users, Fuel, ReceiptText].map((Icon, i) => (
              <span key={i} className={`fs-dw__railbtn ${i === 0 ? 'is-active' : ''}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
            ))}
            <span className="fs-dw__railbtn fs-dw__railbtn--end">
              <Settings className="h-3.5 w-3.5" />
            </span>
          </aside>

          <div className="fs-dw__main">
            <div className="fs-dw__top">
              {[
                ['Active', '3/4'],
                ['Drivers', '4'],
                ['Trips', '14'],
                ['Avg.', '9.6 km/L'],
              ].map(([k, v]) => (
                <span key={k} className="fs-dw__kpi">
                  <em>{k}</em>
                  {v}
                </span>
              ))}
              <span className="fs-dw__search">Search vehicles, trips, or more…</span>
              <span className="fs-dw__bell">
                <Bell className="h-3 w-3" />
              </span>
              <span className="fs-dw__user">DF</span>
            </div>

            <div className="fs-dw__titlerow">
              <div>
                <p className="fs-dw__title">Operations Dashboard</p>
                <p className="fs-dw__sub">Saturday, 10 October 2026 · updated 09:17</p>
              </div>
              <span className="fs-dw__add">+ Add vehicle</span>
            </div>

            <div className="fs-dw__grid">
              <div className={`fs-dw__card ${zone('receipts')}`}>
                {pin(1, 'receipts')}
                <div className="fs-dw__cardhead">
                  <span>
                    <ReceiptText className="h-3 w-3" /> Fuel bought · last 30 days
                  </span>
                  <span className="fs-dw__toggle">
                    <i className="is-on">Receipts</i>
                    <i>Estimated burn</i>
                  </span>
                </div>
                <p className="fs-dw__big">NGN 120,000</p>
                <p className="fs-dw__meta">85.0 L paid for at the pump this period</p>
                <p className="fs-dw__minihead">Receipts by day</p>
                <div className="fs-dw__bars">
                  {BARS.map((h, i) => (
                    <i key={i} style={{ height: h ? `${h * 1.6}%` : undefined }} className={h ? '' : 'is-empty'} />
                  ))}
                </div>
              </div>

              <div className={`fs-dw__card ${zone('trips')}`}>
                {pin(2, 'trips')}
                <div className="fs-dw__cardhead">
                  <span>
                    <Route className="h-3 w-3" /> Distance · 30d
                  </span>
                </div>
                <p className="fs-dw__big">
                  459 <small>km</small>
                </p>
                <p className="fs-dw__meta">27 trips over 14 active days</p>
                <dl className="fs-dw__rows">
                  <div>
                    <dt>Busiest day</dt>
                    <dd>Sun 27 Sept · 115 km</dd>
                  </div>
                  <div>
                    <dt>Typical trip</dt>
                    <dd>17.0 km</dd>
                  </div>
                </dl>
                <div className="fs-dw__trips">
                  {ROUTES.map((d, i) => (
                    <span key={i} className="fs-dw__trip">
                      <svg viewBox="0 0 80 48">
                        <path d={d} />
                        <circle cx={d.split(' ')[0].slice(1)} cy={d.split(' ')[1]} r="2.2" className="is-start" />
                      </svg>
                      <em>{['28.6 km', '12.0 km', '41.8 km'][i]}</em>
                    </span>
                  ))}
                </div>
              </div>

              <div className={`fs-dw__card fs-dw__card--wide ${zone('health')}`}>
                {pin(3, 'health')}
                <span className="fs-dw__healthicon">
                  <Gauge className="h-4 w-4" />
                </span>
                <div>
                  <p className="fs-dw__eyebrow">Fleet status</p>
                  <p className="fs-dw__health">Needs attention</p>
                  <p className="fs-dw__meta">
                    43/100 · driven by <u>37 open alerts</u>, 0 theft flags
                  </p>
                </div>
                <div className="fs-dw__loss">
                  <p className="fs-dw__eyebrow">Preventable loss · 30d</p>
                  <p className="fs-dw__lossbig">NGN 28,164</p>
                  <p className="fs-dw__meta">stop-start NGN 16,929 · idling NGN 11,345</p>
                </div>
              </div>
            </div>

            <span className={`fs-dw__brain ${zone('brain')}`}>
              {pin(4, 'brain')}
              <Brain className="h-3.5 w-3.5" /> FuelBrain
            </span>
          </div>
        </div>
      </div>

      <ol className="fs-dw__notes">
        {NOTES.map((note) => (
          <li
            key={note.n}
            className={focus === note.area ? 'is-focus' : ''}
            onMouseEnter={() => setFocus(note.area)}
            onMouseLeave={() => setFocus(null)}
          >
            <span className="fs-dw__notenum">{note.n}</span>
            <div>
              <p className="fs-dw__notetitle">{note.title}</p>
              <p className="fs-small">{note.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
