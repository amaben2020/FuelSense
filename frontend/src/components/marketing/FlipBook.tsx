'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';

/**
 * "How it works" as a printed field guide whose leaves turn as you scroll.
 *
 * Built from CSS 3D transforms rather than a canvas: every page is real DOM,
 * so the text is selectable, crisp at any zoom and readable by assistive
 * technology. The section pins; scroll progress maps to a page index, and
 * each leaf rotates about the spine with a lighting gradient that follows
 * its angle. The book slides from closed (cover centred) to open as the
 * first leaf turns. Phones get the same pages stacked, without the pin.
 */

type Page = { kind: 'cover' | 'back' | 'page'; node: React.ReactNode };

function Folio({ n, title }: { n: number; title: string }) {
  return (
    <p className="fb-book__folio">
      <span>{String(n).padStart(2, '0')}</span>
      {title}
    </p>
  );
}

const COVER = (
  <div className="fb-book__cover">
    <p className="fb-book__coverkicker">A field guide</p>
    <p className="fb-book__covertitle">
      How FuelSense
      <br />
      <em>works</em>
    </p>
    <svg viewBox="0 0 120 120" className="fb-book__coverart" aria-hidden>
      <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" />
      <circle cx="60" cy="60" r="28" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M22 78 C 40 70, 46 44, 62 46 S 88 30, 98 24" fill="none" stroke="#cde04a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="98" cy="24" r="4" fill="#cde04a" />
    </svg>
    <p className="fb-book__coverfoot">Five chapters · every figure shows its working</p>
  </div>
);

const PAGES: Page[] = [
  { kind: 'cover', node: COVER },
  {
    kind: 'page',
    node: (
      <>
        <Folio n={1} title="The tracker" />
        <svg viewBox="0 0 260 170" className="fb-book__fig" aria-hidden>
          <rect x="30" y="40" width="200" height="100" rx="34" className="ink" />
          <rect x="88" y="58" width="84" height="64" rx="12" className="ink dash" />
          <rect x="112" y="80" width="36" height="20" rx="4" className="lime" />
          <path d="M130 80 V 52 H 196" className="wire red" />
          <path d="M130 100 V 128 H 92" className="wire amber" />
          <rect x="196" y="44" width="18" height="16" rx="3" className="ink" />
          <circle cx="86" cy="128" r="6" className="ink" />
          <text x="205" y="72" className="lab">12 V</text>
          <text x="70" y="150" className="lab">IGN</text>
        </svg>
        <p className="fb-book__caption">Fig. 1 — Wired to power and ignition, behind the dash.</p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <h3 className="fb-book__h">The tracker is fitted</h3>
        <p>
          A professional-grade GPS tracker is wired into the vehicle&rsquo;s power and ignition.
          From that moment it reports position, speed, ignition and movement over the mobile
          network: every few seconds while driving, hourly at rest.
        </p>
        <p>Nothing is spliced into the fuel line and nothing is fitted in the tank.</p>
        <ul className="fb-book__list">
          <li>
            <b>Ignition</b> opens and closes trips
          </li>
          <li>
            <b>Odometer</b> validates distance
          </li>
          <li>
            <b>Speed</b> separates driving from idling
          </li>
        </ul>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <Folio n={2} title="Litres" />
        <div className="fb-book__eq">
          <p className="fb-book__eqlabel">Fuel for the distance</p>
          <p className="fb-book__eqform">km ÷ rated km/L</p>
          <p className="fb-book__eqsub">
            30.4 ÷ 9.8 = <b>3.10 L</b>
          </p>
        </div>
        <div className="fb-book__eq">
          <p className="fb-book__eqlabel">Fuel for the idling</p>
          <p className="fb-book__eqform">idle h × idle L/h</p>
          <p className="fb-book__eqsub">
            0.37 × 0.9 = <b>0.33 L</b>
          </p>
        </div>
        <p className="fb-book__caption">Worked example: one trip in a 2013 RAV4.</p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <h3 className="fb-book__h">Distance and idling become litres</h3>
        <p>
          Odometer-validated distance is divided by the vehicle&rsquo;s rated economy: the official
          city figure for its model and year, or the rate you set yourself.
        </p>
        <p>
          Engine-on minutes standing still (speed under 2 km/h) are added at an idle burn rate,
          counted to the minute from the tracker&rsquo;s ignition and speed.
        </p>
        <p className="fb-book__aside">The sum is a model, and it is labelled as one everywhere it appears.</p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <Folio n={3} title="Naira" />
        <h3 className="fb-book__h">Litres become naira</h3>
        <p>
          Each litre is priced at the fuel price in force the day it burned, so last month&rsquo;s
          cost never changes when today&rsquo;s price does.
        </p>
        <p>
          Receipts your drivers file are the money actually paid. They set the day&rsquo;s price and
          are shown beside the estimate, never blended into it.
        </p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <div className="fb-book__receipt">
        <p className="fb-book__rhead">NNPC RETAIL · WUSE</p>
        <p>
          <span>VOLUME</span>
          <span>40.00 L</span>
        </p>
        <p>
          <span>PRICE/L</span>
          <span>1,300.00</span>
        </p>
        <p className="fb-book__rtotal">
          <span>TOTAL ₦</span>
          <span>52,000.00</span>
        </p>
        <p className="fb-book__rstamp">Sets the day&rsquo;s price</p>
        <p className="fb-book__eqsub" style={{ marginTop: '1rem' }}>
          3.43 L × 1,300 = <b>₦4,459</b>
        </p>
      </div>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <Folio n={4} title="Honesty" />
        <h3 className="fb-book__h">An estimate that admits it is one</h3>
        <p>
          These trackers have no fuel sensor and no link to the engine computer. Litres are
          modelled from what the tracker measures well: how far the vehicle went, and how long the
          engine ran while it stood still.
        </p>
        <p>The only fuel figure treated as fact is a receipt.</p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <p className="fb-book__eqlabel">Trip confidence</p>
        <div className="fb-book__meter">
          <i style={{ width: '82%' }} />
        </div>
        <p className="fb-book__eqform" style={{ marginTop: '0.4rem' }}>
          82 / 100
        </p>
        <ul className="fb-book__list">
          <li>− 8 · a 6-minute reporting gap near Kubwa</li>
          <li>− 6 · cold start without a GPS lock</li>
          <li>− 4 · sparse fixes in the first kilometre</li>
        </ul>
        <p className="fb-book__caption">Every score carries its reasons.</p>
      </>
    ),
  },
  {
    kind: 'page',
    node: (
      <>
        <Folio n={5} title="The working" />
        <h3 className="fb-book__h">Three lines, published</h3>
        <ol className="fb-book__lines">
          <li>
            <span>Distance</span> km ÷ rated km/L
          </li>
          <li>
            <span>Idling</span> idle h × idle L/h
          </li>
          <li>
            <span>Cost</span> litres × ₦/L that day
          </li>
        </ol>
        <p>
          Nothing hides behind a &ldquo;proprietary algorithm&rdquo;. A number you cannot check is a
          number you cannot act on.
        </p>
      </>
    ),
  },
  {
    kind: 'back',
    node: (
      <div className="fb-book__cover fb-book__cover--back">
        <p className="fb-book__covertitle" style={{ fontSize: '1.8rem' }}>
          Every figure
          <br />
          shows its <em>working</em>.
        </p>
        <a href="/documentation" className="fb-book__more">
          Read the full method →
        </a>
      </div>
    ),
  },
];

// Leaves: page 0 is the cover (front of leaf 0); each leaf's back is the
// next even page. The final page is the back cover, on the right.
const LEAVES = Math.floor(PAGES.length / 2);

export function FlipBook() {
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const [turn, setTurn] = useState(0); // 0 … LEAVES, fractional while turning
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px), (prefers-reduced-motion: reduce)');
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || mobile) return;
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top+=88',
      end: `+=${LEAVES * 70}%`,
      pin: true,
      scrub: 0.7,
      snap: { snapTo: 1 / LEAVES, duration: { min: 0.2, max: 0.6 }, ease: 'power2.inOut', delay: 0.08 },
      onUpdate: (self) => setTurn(self.progress * LEAVES),
    });
    triggerRef.current = st;
    return () => {
      st.kill();
      triggerRef.current = null;
    };
  }, [mobile]);

  const goTo = (leaf: number) => {
    const st = triggerRef.current;
    if (!st) return;
    const target = st.start + ((st.end - st.start) * Math.max(0, Math.min(LEAVES, leaf))) / LEAVES;
    window.scrollTo({ top: target + 2, behavior: 'smooth' });
  };

  if (mobile) {
    return (
      <div className="fb-book--stack">
        {PAGES.map((p, i) => (
          <div key={i} className={`fb-book__page fb-book__page--${p.kind}`}>
            {p.node}
          </div>
        ))}
      </div>
    );
  }

  // Closed → open: the cover starts centred and the book slides as leaf 0 turns.
  const shift = 1 - Math.min(1, turn);
  const atEnd = turn > LEAVES - 0.5;

  return (
    <div ref={root} className="fb-bookwrap">
      <div className="fb-book" style={{ ['--shift' as string]: shift }}>
        <div className="fb-book__base fb-book__base--left" aria-hidden />
        <div className="fb-book__base fb-book__base--right">
          <div className="fb-book__face">{PAGES[PAGES.length - 1].node}</div>
        </div>

        {Array.from({ length: LEAVES }, (_, i) => {
          const local = Math.max(0, Math.min(1, turn - i)); // 0 flat right, 1 flat left
          const angle = -180 * local;
          const lift = Math.sin(local * Math.PI);
          const turned = local > 0.5;
          const front = PAGES[i * 2];
          const back = PAGES[i * 2 + 1];
          return (
            <div
              key={i}
              className="fb-book__leaf"
              style={{
                transform: `rotateY(${angle}deg) translateZ(${lift * 24}px)`,
                zIndex: turned ? 100 + i : 100 + LEAVES - i,
              }}
            >
              <div className={`fb-book__face fb-book__face--front fb-book__page--${front.kind}`}>
                {front.node}
                <span className="fb-book__shade" style={{ opacity: lift * 0.55 }} />
              </div>
              <div className={`fb-book__face fb-book__face--back fb-book__page--${back?.kind ?? 'page'}`}>
                {back?.node}
                <span className="fb-book__shade fb-book__shade--back" style={{ opacity: lift * 0.45 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="fb-book__controls">
        <button type="button" onClick={() => goTo(Math.round(turn) - 1)} disabled={turn < 0.5} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="fb-book__dots" role="tablist" aria-label="Pages">
          {Array.from({ length: LEAVES + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={Math.round(turn) === i}
              aria-label={i === 0 ? 'Cover' : `Spread ${i}`}
              onClick={() => goTo(i)}
              className={Math.round(turn) === i ? 'is-on' : ''}
            />
          ))}
        </div>
        <button type="button" onClick={() => goTo(Math.round(turn) + 1)} disabled={atEnd} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" className="fb-book__skip" onClick={() => goTo(LEAVES)} disabled={atEnd}>
          Skip to end <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
