'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// The arithmetic, shown rather than described.
//
// Every cost FuelSense puts on screen reduces to these three lines. Publishing
// them is the point: a fleet manager who can see the formula can argue with
// it, and a formula that survives being argued with is worth trusting. Each
// row shows the symbolic form, then substitutes the numbers from one trip.

interface Equation {
  id: string;
  label: string;
  formula: string;
  substituted: string;
  result: string;
  note: string;
}

const EQUATIONS: Equation[] = [
  {
    id: 'drive',
    label: 'Fuel for the distance',
    formula: 'km ÷ rated km/L',
    substituted: '30.4 ÷ 9.8',
    result: '3.10 L',
    note: 'Odometer-validated distance over the vehicle’s official city economy for its model and year, or the rate you set.',
  },
  {
    id: 'idle',
    label: 'Fuel for the idling',
    formula: 'idle hours × idle L/h',
    substituted: '0.37 × 0.9',
    result: '0.33 L',
    note: 'Engine on, speed under 2 km/h, counted to the minute from the tracker’s ignition and speed.',
  },
  {
    id: 'cost',
    label: 'What it cost',
    formula: 'litres × ₦/L that day',
    substituted: '3.43 × 1,300',
    result: '₦4,459',
    note: 'Priced at the fuel price in force on the day. Receipts stay separate: they are what was paid, shown beside this, never mixed in.',
  },
];

export function FuelMath() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-eq]', scope).forEach((row, i) => {
        // The symbolic form arrives first, then the numbers slot into it, so
        // the eye reads the shape before the values.
        const tl = gsap.timeline({
          scrollTrigger: { trigger: row, start: 'top 90%', once: true },
        });

        tl.from(row, { opacity: 0, x: -14, duration: 0.5, ease: 'power2.out', delay: i * 0.04 })
          .from(
            row.querySelector('[data-eq-sub]'),
            { opacity: 0, y: 6, duration: 0.4, ease: 'power2.out' },
            '-=0.15'
          )
          .from(
            row.querySelector('[data-eq-result]'),
            { opacity: 0, scale: 0.9, duration: 0.45, ease: 'back.out(2)' },
            '-=0.2'
          );
      });
    }, scope);

    return () => ctx.revert();
  }, []);

  return (
    <div className="fs-math" ref={root}>
      <p className="fs-math__head">The three lines that matter</p>

      <ol className="fs-math__list">
        {EQUATIONS.map((eq) => (
          <li className="fs-math__row" key={eq.id} data-eq>
            <p className="fs-math__label">{eq.label}</p>

            <p className="fs-math__formula">{eq.formula}</p>

            <p className="fs-math__sub" data-eq-sub>
              <span className="fs-math__subvalue">{eq.substituted}</span>
              <span className="fs-math__eq">=</span>
              <span className="fs-math__result" data-eq-result>
                {eq.result}
              </span>
            </p>

            <p className="fs-math__note">{eq.note}</p>
          </li>
        ))}
      </ol>

      <p className="fs-math__foot">
        Figures from one trip in a 2013 RAV4. Nothing is hidden behind a
        &ldquo;proprietary algorithm&rdquo;, because a number you cannot check is a number you
        cannot act on.{' '}
        <a className="fs-math__link" href="/documentation">
          See the full method, with worked numbers
        </a>
      </p>
    </div>
  );
}
