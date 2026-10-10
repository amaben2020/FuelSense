'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Bell, Camera, Check, ScanText } from 'lucide-react';

/**
 * Receipts, from the forecourt to the books.
 *
 * A phone photographs the slip, the scan reads it, the three fields land in
 * the ledger, and the vehicle's virtual tank takes the litres. Beside it, the
 * modelled burn since that fill, which is the comparison a manager actually
 * wants. What is shown is what the product does: no fuel sensor, no
 * "verification" theatre; a receipt is money paid and is credited as such.
 */

const FIELDS = [
  ['Merchant', 'NNPC Wuse'],
  ['Litres', '40.0 L'],
  ['Amount', '₦52,000'],
] as const;

const STEPS = [
  { icon: Camera, title: 'Photo at the pump', body: 'From the driver app. Managers can file one for a driver without a phone.' },
  { icon: ScanText, title: 'Read, then confirmed', body: 'OCR fills in merchant, litres and amount; the person filing checks them before saving.' },
  { icon: Bell, title: 'Credited and reported', body: 'The litres join the vehicle’s virtual tank and the manager is notified with the slip.' },
  { icon: Check, title: 'Sets the day’s price', body: 'The price paid values every litre burned that day, so costs follow the real pump price.' },
];

export function ReceiptJourney() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: scope, start: 'top 70%', once: true } });
      tl.from('[data-rj-phone]', { y: 40, opacity: 0, rotate: -4, duration: 0.8, ease: 'power3.out' })
        .from('[data-rj-flash]', { opacity: 0.9, duration: 0.25, ease: 'power1.out' }, '+=0.15')
        .fromTo('[data-rj-scan]', { top: '6%', opacity: 1 }, { top: '92%', duration: 1.1, ease: 'power1.inOut' })
        .to('[data-rj-scan]', { opacity: 0, duration: 0.2 })
        .from('[data-rj-hit]', { backgroundColor: 'rgba(205,224,74,0.35)', duration: 0.6, stagger: 0.12 }, '-=1')
        .from('[data-rj-field]', { x: -30, opacity: 0, duration: 0.5, stagger: 0.14, ease: 'power3.out' }, '-=0.4')
        .from('[data-rj-fill]', { scaleX: 0, transformOrigin: 'left center', duration: 1, ease: 'expo.out' }, '-=0.1')
        .from('[data-rj-burn]', { scaleX: 0, transformOrigin: 'left center', duration: 1.2, ease: 'power2.out' }, '-=0.5')
        .from('[data-rj-step]', { y: 18, opacity: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out' }, '-=0.6');
    }, scope);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="fs-rj">
      <div className="fs-rj__stage">
        {/* The phone and the slip */}
        <div className="fs-rj__phone" data-rj-phone>
          <div className="fs-rj__notch" />
          <div className="fs-rj__screen">
            <p className="fs-rj__apptitle">File a receipt · LAG-001-FS</p>
            <div className="fs-rj__slip">
              <span className="fs-rj__flash" data-rj-flash />
              <span className="fs-rj__scan" data-rj-scan />
              <p className="fs-rj__slipbrand" data-rj-hit>NNPC RETAIL</p>
              <p className="fs-rj__sliploc">WUSE ZONE 4, ABUJA</p>
              <p className="fs-rj__sliprow">
                <span>PUMP 3 · PMS</span>
                <span>10/10/26 14:05</span>
              </p>
              <p className="fs-rj__sliprow" data-rj-hit>
                <span>VOLUME</span>
                <span>40.00 L</span>
              </p>
              <p className="fs-rj__sliprow">
                <span>PRICE/L</span>
                <span>1,300.00</span>
              </p>
              <p className="fs-rj__sliprow fs-rj__sliprow--total" data-rj-hit>
                <span>TOTAL ₦</span>
                <span>52,000.00</span>
              </p>
              <p className="fs-rj__slipthanks">THANK YOU</p>
            </div>
            <span className="fs-rj__shutter" />
          </div>
        </div>

        {/* What the scan produced, and what it means for the tank */}
        <div className="fs-rj__ledger">
          <p className="fs-rj__ledgerhead">Bought · receipts</p>
          <dl className="fs-rj__fields">
            {FIELDS.map(([k, v]) => (
              <div key={k} data-rj-field>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="fs-rj__tank">
            <div className="fs-rj__tankhead">
              <span>Virtual tank · since this fill</span>
              <span className="fs-rj__mono">40.0 L in</span>
            </div>
            <div className="fs-rj__tankbar">
              <i className="fs-rj__tankfill" data-rj-fill />
              <i className="fs-rj__tankburn" data-rj-burn style={{ width: '81%' }} />
            </div>
            <div className="fs-rj__tanklegend">
              <span>
                <i className="is-fill" /> Bought 40.0 L
              </span>
              <span>
                <i className="is-burn" /> Modelled burn 32.5 L
              </span>
              <span className="fs-rj__mono">≈ 7.5 L should remain</span>
            </div>
          </div>
          <p className="fs-rj__note">
            The receipt is the fact; the burn is the model. They sit side by side so a gap is a
            question with a date and a number, not an accusation.
          </p>
        </div>
      </div>

      <ol className="fs-rj__steps">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} data-rj-step>
            <span className="fs-rj__stepicon">
              <Icon className="h-4 w-4" />
            </span>
            <span className="fs-rj__stepnum">{String(i + 1).padStart(2, '0')}</span>
            <p className="fs-rj__steptitle">{title}</p>
            <p className="fs-small">{body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
