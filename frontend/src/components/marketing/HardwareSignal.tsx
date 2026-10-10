'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hardware, as the path a single record travels.
 *
 * A blueprint of the vehicle with the tracker behind the dash, wired to power
 * and ignition; satellites giving it a fix; the record leaving over the mobile
 * network, reaching FuelSense and landing on a dashboard tile. Four steps
 * play in turn while the section is on screen. Everything named is what the
 * device and the platform actually do, including the part people ask about
 * most: what happens with no signal.
 */

const STEPS = [
  {
    key: 'ignition',
    title: 'Ignition on',
    body: 'The device is wired to the vehicle’s power and ignition. The ignition edge (AVL 239) opens a trip.',
  },
  {
    key: 'gnss',
    title: 'A satellite fix',
    body: 'Position, speed and heading every few seconds while driving, hourly while parked. Odometer from AVL 16.',
  },
  {
    key: 'send',
    title: 'Sent over the mobile network',
    body: 'Records go out over LTE. With no coverage they wait in the device’s memory and upload in order when it returns.',
  },
  {
    key: 'land',
    title: 'On the dashboard',
    body: 'The server acknowledges each record, then it is a trip, a stop or an idle minute on the manager’s screen.',
  },
] as const;

const PATH = 'M 236 214 C 330 214, 380 250, 468 250 S 590 150, 676 150 S 780 250, 832 262';

export function HardwareSignal() {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const animate = typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !animate) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => window.clearInterval(id);
  }, [visible, animate]);

  // A live record, advancing once a second while the section is on screen.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!visible || !animate) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [visible, animate]);
  const rec = {
    time: `07:12:${String(4 + (tick % 56)).padStart(2, '0')}`,
    lat: (9.07701 + tick * 0.00021).toFixed(5),
    lng: (7.40012 + tick * 0.00034).toFixed(5),
    speed: 38 + Math.round(Math.abs(Math.sin(tick * 0.7)) * 24),
    odo: (81802.4 + tick * 0.17).toFixed(1),
    sats: 9 + (tick % 4),
    ack: 1041 + tick,
    km: (18.4 + tick * 0.17).toFixed(1),
  };

  const on = (k: (typeof STEPS)[number]['key']) => (STEPS[step].key === k ? 'is-on' : '');

  return (
    <div ref={root} className="fs-hw">
      <div className="fs-hw__stage">
        <svg viewBox="0 0 900 420" className="fs-hw__svg" role="img" aria-label="A record travelling from the tracker in the vehicle, over the mobile network, to the FuelSense dashboard">
          <defs>
            <pattern id="hw-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="rgba(237,237,241,0.05)" strokeWidth="1" />
            </pattern>
            <radialGradient id="hw-chip" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#cde04a" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#cde04a" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="hw-path" x1="0" x2="1">
              <stop offset="0%" stopColor="#cde04a" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#cde04a" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <rect width="900" height="420" fill="url(#hw-grid)" />

          {/* Satellites */}
          <g className={`fs-hw__part ${on('gnss')}`}>
            {[
              [150, 46],
              [260, 28],
              [370, 52],
            ].map(([x, y], i) => (
              <g key={i}>
                <line x1={x} y1={y + 10} x2={236} y2={206} className="fs-hw__ray" />
                <g transform={`translate(${x} ${y}) rotate(-20)`}>
                  <rect x="-5" y="-5" width="10" height="10" rx="2" className="fs-hw__sat" />
                  <rect x="-20" y="-3" width="12" height="6" className="fs-hw__panel" />
                  <rect x="8" y="-3" width="12" height="6" className="fs-hw__panel" />
                </g>
              </g>
            ))}
            <text x="260" y="14" className="fs-hw__label" textAnchor="middle">GNSS</text>
          </g>

          {/* Vehicle blueprint, top-down */}
          <g className="fs-hw__car">
            <rect x="60" y="120" width="290" height="190" rx="46" />
            <path d="M 120 128 C 132 172, 132 258, 120 302" />
            <path d="M 286 132 C 300 172, 300 258, 286 298" />
            <rect x="140" y="150" width="130" height="130" rx="18" className="fs-hw__cabin" />
            {[
              [92, 108],
              [292, 108],
              [92, 300],
              [292, 300],
            ].map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="34" height="22" rx="6" className="fs-hw__wheel" />
            ))}
          </g>

          {/* Wiring to power and ignition */}
          <g className={`fs-hw__part ${on('ignition')}`}>
            <path d="M 236 214 L 236 168 L 318 168" className="fs-hw__wire fs-hw__wire--power" />
            <rect x="318" y="156" width="26" height="24" rx="4" className="fs-hw__batt" />
            <text x="331" y="196" className="fs-hw__tiny" textAnchor="middle">12 V</text>
            <path d="M 236 214 L 236 262 L 196 262" className="fs-hw__wire fs-hw__wire--ign" />
            <circle cx="186" cy="262" r="9" className="fs-hw__key" />
            <text x="186" y="286" className="fs-hw__tiny" textAnchor="middle">IGN</text>
          </g>

          {/* The tracker */}
          <circle cx="236" cy="214" r="34" fill="url(#hw-chip)" className="fs-hw__glow" />
          <rect x="208" y="202" width="56" height="24" rx="5" className="fs-hw__chip" />
          <text x="236" y="218" className="fs-hw__chiptext" textAnchor="middle">TRACKER</text>

          {/* The record's path out */}
          <path d={PATH} className="fs-hw__route" stroke="url(#hw-path)" />
          {animate &&
            [0, 1, 2].map((i) => (
              <g key={i}>
                <circle r="4" className="fs-hw__packet" />
                <text y="-9" className="fs-hw__pktlabel" textAnchor="middle">
                  {['GPS', 'IO', 'ODO'][i]}
                </text>
                <animateMotion dur="2.6s" begin={`${i * 0.87}s`} repeatCount="indefinite" path={PATH} />
              </g>
            ))}

          {/* Tower */}
          <g className={`fs-hw__part ${on('send')}`} transform="translate(468 250)">
            <path d="M -14 44 L 0 -6 L 14 44 M -9 26 H 9 M -6 12 H 6" className="fs-hw__tower" />
            <path d="M -16 -14 A 22 22 0 0 1 16 -14 M -26 -22 A 34 34 0 0 1 26 -22" className="fs-hw__waves" />
            <text x="0" y="66" className="fs-hw__label" textAnchor="middle">LTE</text>
            {[0, 1, 2, 3].map((b) => (
              <rect key={b} x={22 + b * 6} y={34 - b * 5} width="4" height={8 + b * 5} rx="1" className="fs-hw__bar4" style={{ animationDelay: `${b * 0.15}s` }} />
            ))}
          </g>

          {/* FuelSense */}
          <g className={`fs-hw__part ${on('land')}`} transform="translate(676 150)">
            <rect x="-58" y="-44" width="116" height="92" rx="12" className="fs-hw__server" />
            <text x="0" y="-24" className="fs-hw__servertitle" textAnchor="middle">FuelSense</text>
            {[0, 1, 2].map((r) => (
              <g key={r} transform={`translate(-44 ${-14 + r * 16})`}>
                <rect width="88" height="11" rx="3" className="fs-hw__rack" />
                <circle cx="8" cy="5.5" r="2" className="fs-hw__led" style={{ animationDelay: `${r * 0.4}s` }} />
                <rect x="16" y="4" width={30 + r * 8} height="3" rx="1.5" className="fs-hw__rackbar" />
              </g>
            ))}
            <text x="0" y="62" className="fs-hw__tiny" textAnchor="middle">ACK #{rec.ack}</text>
          </g>

          {/* Dashboard tile */}
          <g className={`fs-hw__part ${on('land')}`} transform="translate(832 262)">
            <rect x="-56" y="-36" width="112" height="84" rx="10" className="fs-hw__tile" />
            <text x="-44" y="-16" className="fs-hw__tiny">TRIP · 07:12</text>
            <text x="-44" y="6" className="fs-hw__tilebig">{rec.km} km</text>
            <path d="M -44 30 L -24 22 L -6 27 L 14 14 L 44 18" className="fs-hw__spark" />
          </g>
        </svg>

        <div className="fs-hw__inspect" aria-live="off">
          <p className="fs-hw__inspecthead">
            <i /> Record · {rec.time}
          </p>
          <dl>
            {[
              ['lat', rec.lat],
              ['lng', rec.lng],
              ['speed', `${rec.speed} km/h`],
              ['ign', 'on'],
              ['odometer', `${rec.odo} km`],
              ['satellites', String(rec.sats)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd key={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <ol className="fs-hw__steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? 'is-active' : ''}>
            <button type="button" onClick={() => setStep(i)}>
              <span className="fs-hw__num">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <span className="fs-hw__steptitle">{s.title}</span>
                <span className="fs-hw__stepbody">{s.body}</span>
              </span>
            </button>
            <span className="fs-hw__bar" aria-hidden>
              <i />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
