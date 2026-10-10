'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Bell, Camera, Check, Paperclip, ScanText } from 'lucide-react';

/**
 * Receipts, from the forecourt to the books, driven by scroll.
 *
 * The stage pins. Scrolling scans the slip in the phone, reads its three
 * fields into a new row of the dashboard's receipts list, then lifts the slip
 * out of the phone and files it into that row as the evidence thumbnail. The
 * tank bar fills last. Reverse the scroll and it unfiles itself. What is shown
 * is what the product does: a receipt is money paid, credited as such, with
 * the photo kept beside it.
 */

const STEPS = [
  { icon: Camera, title: 'Photo at the pump', body: 'From the driver app. Managers can file one for a driver without a phone.' },
  { icon: ScanText, title: 'Read, then confirmed', body: 'OCR fills in merchant, litres and amount; the person filing checks them before saving.' },
  { icon: Bell, title: 'Credited and reported', body: 'The litres join the vehicle’s virtual tank and the manager is notified with the slip.' },
  { icon: Check, title: 'Sets the day’s price', body: 'The price paid values every litre burned that day, so costs follow the real pump price.' },
];

function Slip({ className = '', hit = false }: { className?: string; hit?: boolean }) {
  return (
    <div className={`fs-rj__slip ${className}`}>
      <p className="fs-rj__slipbrand" data-rj-hit={hit || undefined}>
        NNPC RETAIL
      </p>
      <p className="fs-rj__sliploc">WUSE ZONE 4, ABUJA</p>
      <p className="fs-rj__sliprow">
        <span>PUMP 3 · PMS</span>
        <span>10/10/26 14:05</span>
      </p>
      <p className="fs-rj__sliprow" data-rj-hit={hit || undefined}>
        <span>VOLUME</span>
        <span>40.00 L</span>
      </p>
      <p className="fs-rj__sliprow">
        <span>PRICE/L</span>
        <span>1,300.00</span>
      </p>
      <p className="fs-rj__sliprow fs-rj__sliprow--total" data-rj-hit={hit || undefined}>
        <span>TOTAL ₦</span>
        <span>52,000.00</span>
      </p>
      <p className="fs-rj__slipthanks">THANK YOU</p>
    </div>
  );
}

export function ReceiptJourney() {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    const st = stage.current;
    if (!scope || !st || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const slip = st.querySelector<HTMLElement>('[data-rj-source]')!;
      const thumb = st.querySelector<HTMLElement>('[data-rj-thumb]')!;
      const fly = st.querySelector<HTMLElement>('[data-rj-fly]')!;
      // Where the slip sits and where it lands, relative to the stage. Read
      // fresh on every refresh so a resize re-aims the flight.
      const rel = (el: HTMLElement) => {
        const a = el.getBoundingClientRect();
        const b = st.getBoundingClientRect();
        return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
      };
      // The clone keeps the slip's own size and is scaled down in flight, so
      // the whole slip shrinks into the thumbnail rather than being cropped.
      const place = () => {
        const s = rel(slip);
        gsap.set(fly, { x: s.x, y: s.y, width: s.w, height: s.h, scale: 1, rotate: -1.5, transformOrigin: '0 0' });
      };
      place();

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: st,
          start: 'top top+=96',
          end: '+=170%',
          pin: true,
          scrub: 0.8,
          invalidateOnRefresh: true,
          onRefresh: place,
        },
      });
      tl.fromTo('[data-rj-scan]', { top: '4%', opacity: 1 }, { top: '94%', duration: 1 })
        .to('[data-rj-scan]', { opacity: 0, duration: 0.1 })
        .fromTo('[data-rj-hit]', { backgroundColor: 'rgba(205,224,74,0)' }, { backgroundColor: 'rgba(205,224,74,0.45)', duration: 0.3, stagger: 0.15 }, 0.2)
        .fromTo('[data-rj-row]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35 }, 1.05)
        .fromTo('[data-rj-cell]', { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.18 }, 1.25)
        .set(fly, { opacity: 1 }, 1.9)
        .to(slip, { opacity: 0.12, duration: 0.2 }, 1.9)
        .to(
          fly,
          {
            x: () => rel(thumb).x,
            y: () => rel(thumb).y,
            scale: () => rel(thumb).w / rel(slip).w,
            rotate: 0,
            duration: 1,
            ease: 'power2.inOut',
          },
          1.95
        )
        .to(thumb, { opacity: 1, duration: 0.05 }, 2.95)
        .to(fly, { opacity: 0, duration: 0.05 }, 2.95)
        .fromTo('[data-rj-badge]', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2)' }, 3)
        .fromTo('[data-rj-fill]', { scaleX: 0 }, { scaleX: 1, duration: 0.5, transformOrigin: 'left center' }, 3.05)
        .fromTo('[data-rj-burn]', { scaleX: 0 }, { scaleX: 1, duration: 0.6, transformOrigin: 'left center' }, 3.2);

      gsap.from('[data-rj-step]', {
        y: 18,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: scope.querySelector('.fs-rj__steps'), start: 'top 85%', once: true },
      });
    }, scope);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="fs-rj">
      <div ref={stage} className="fs-rj__stage">
        <div className="fs-rj__phone">
          <div className="fs-rj__notch" />
          <div className="fs-rj__screen">
            <p className="fs-rj__apptitle">File a receipt · LAG-001-FS</p>
            <div className="fs-rj__slipwrap" data-rj-source>
              <span className="fs-rj__scan" data-rj-scan />
              <Slip hit />
            </div>
            <span className="fs-rj__shutter" />
          </div>
        </div>

        {/* The dashboard's receipts list, where the slip is filed. */}
        <div className="fs-rj__app">
          <div className="fs-rj__appbar">
            <span className="fs-rj__appdots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span>FuelSense · Receipts</span>
            <span className="fs-rj__appmeta">October</span>
          </div>
          <div className="fs-rj__table">
            <div className="fs-rj__thead">
              <span>Evidence</span>
              <span>Merchant</span>
              <span>Litres</span>
              <span>Amount</span>
            </div>
            <div className="fs-rj__tr is-new" data-rj-row>
              <span className="fs-rj__thumbslot">
                <span className="fs-rj__thumb" data-rj-thumb>
                  <Slip className="fs-rj__slip--mini" />
                </span>
              </span>
              <span data-rj-cell>
                NNPC Wuse
                <em>10 Oct · 14:05 · LAG-001-FS</em>
              </span>
              <span data-rj-cell>40.0 L</span>
              <span data-rj-cell>
                ₦52,000
                <i className="fs-rj__badge" data-rj-badge>
                  <Paperclip className="h-3 w-3" /> Evidence attached
                </i>
              </span>
            </div>
            {[
              ['Total Garki', '3 Oct · KUJ-117AA', '38.0 L', '₦49,400'],
              ['Mobil Kubwa', '27 Sep · LAG-001-FS', '30.0 L', '₦39,000'],
            ].map(([m, sub, l, a]) => (
              <div className="fs-rj__tr" key={m}>
                <span className="fs-rj__thumbslot fs-rj__thumbslot--old" />
                <span>
                  {m}
                  <em>{sub}</em>
                </span>
                <span>{l}</span>
                <span>{a}</span>
              </div>
            ))}
          </div>

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
        </div>

        {/* The slip in flight between the phone and the row. */}
        <div className="fs-rj__fly" data-rj-fly aria-hidden>
          <Slip />
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
