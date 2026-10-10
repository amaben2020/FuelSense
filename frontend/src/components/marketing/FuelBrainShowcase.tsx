'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUp, Brain, Check, Maximize2, MessageSquareText, PanelLeft, ShieldCheck, SquarePen } from 'lucide-react';

/**
 * FuelBrain, shown as the product window it is.
 *
 * Built in code rather than pasted as a screenshot, so it stays sharp at any
 * width, follows the theme, and can play the conversation as it scrolls in:
 * the question, the agent reading the fleet, the answer with its chart, and a
 * driver message waiting for approval. The conversation is illustrative and
 * says so; the layout, the tools and the approval step are the real product.
 */

const IDLE = [
  { name: 'Aisha Bello', plate: 'KUJ-117AA', hours: 3.2 },
  { name: 'Benneth Uzochukwu', plate: 'LAG-001-FS', hours: 1.4 },
  { name: 'Musa Ibrahim', plate: 'ABJ-482KT', hours: 0.6 },
];

export function FuelBrainShowcase() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: scope.querySelector('[data-fbw]'), start: 'top 72%', once: true },
      });
      tl.from('[data-fbw]', { y: 40, opacity: 0, duration: 0.9, ease: 'power3.out' })
        .from('[data-fbw-q]', { y: 14, opacity: 0, scale: 0.97, duration: 0.45, ease: 'back.out(1.6)' }, '-=0.3')
        .from('[data-fbw-tool]', { opacity: 0, x: -8, duration: 0.3, stagger: 0.35 }, '+=0.2')
        .to('[data-fbw-tool]', { opacity: 0.45, duration: 0.3 }, '+=0.2')
        .from('[data-fbw-word]', { opacity: 0, duration: 0.01, stagger: 0.028 }, '+=0.05')
        .from('[data-fbw-bar]', { scaleX: 0, transformOrigin: 'left center', duration: 0.8, stagger: 0.12, ease: 'expo.out' }, '-=0.2')
        .from('[data-fbw-tail]', { opacity: 0, y: 8, duration: 0.4, stagger: 0.1 }, '-=0.3')
        .from('[data-fbw-action]', { opacity: 0, y: 16, duration: 0.55, ease: 'power3.out' }, '+=0.1');
    }, scope);
    return () => ctx.revert();
  }, []);

  const answer =
    'Aisha Bello idled the most this week: 3 h 12 min with the engine on and the vehicle standing still. At this week’s ₦1,300/L that is about 2.9 L, or ₦3,770.';

  return (
    <div ref={root} className="fs-fbshow">
      <div className="fs-fbshow__copy">
        <ul className="fs-fbshow__points">
          <li data-reveal>
            <span className="fs-fbshow__icon">
              <Brain className="h-4 w-4" />
            </span>
            <div>
              <p className="fs-fbshow__pointtitle">Answers from your own fleet</p>
              <p className="fs-small">
                FuelBrain reads the same trips, idling, alerts and receipts the dashboard shows. It
                does not guess from the internet; if the data is not there, it says so.
              </p>
            </div>
          </li>
          <li data-reveal>
            <span className="fs-fbshow__icon">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div>
              <p className="fs-fbshow__pointtitle">Shows the working</p>
              <p className="fs-small">
                Figures come with the period, the price and the vehicle they were drawn from, plus a
                chart or table when the question is a comparison.
              </p>
            </div>
          </li>
          <li data-reveal>
            <span className="fs-fbshow__icon">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="fs-fbshow__pointtitle">Nothing is sent without you</p>
              <p className="fs-small">
                It can draft a message to a driver. The draft waits for a manager to approve, edit
                or discard it.
              </p>
            </div>
          </li>
        </ul>
      </div>

      <div className="fs-fbshow__stage">
        <div className="fs-fbwin" data-fbw role="img" aria-label="The FuelBrain window answering which driver idled the most this week">
          <div className="fs-fbwin__bar">
            <span className="fs-fbwin__dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="fs-fbwin__title">
              <Brain className="h-3.5 w-3.5" /> FuelBrain
            </span>
            <Maximize2 className="h-3.5 w-3.5 opacity-50" />
          </div>

          <div className="fs-fbwin__body">
            <aside className="fs-fbwin__side">
              <p className="fs-fbwin__new">
                <SquarePen className="h-3.5 w-3.5" /> New chat
              </p>
              <p className="fs-fbwin__group">Today</p>
              <p className="fs-fbwin__chat is-active">Who idled the most this week?</p>
              <p className="fs-fbwin__chat">Fuel spend last 30 days</p>
              <p className="fs-fbwin__chat">Any alerts to act on?</p>
              <div className="fs-fbwin__credits">
                <span>Monthly credits</span>
                <span className="fs-fbwin__meter">
                  <i style={{ width: '29%' }} />
                </span>
              </div>
            </aside>

            <div className="fs-fbwin__main">
              <div className="fs-fbwin__head">
                <PanelLeft className="h-3.5 w-3.5 opacity-50" />
                <span>Who idled the most this week?</span>
              </div>

              <div className="fs-fbwin__thread">
                <p className="fs-fbwin__q" data-fbw-q>
                  Which driver idled the most this week, and what did it cost?
                </p>

                <div className="fs-fbwin__a">
                  <span className="fs-fbwin__avatar">
                    <Brain className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="fs-fbwin__tool" data-fbw-tool>
                      Reading idle time for 3 vehicles…
                    </p>
                    <p className="fs-fbwin__tool" data-fbw-tool>
                      Pricing at this week’s fuel price…
                    </p>
                    <p className="fs-fbwin__text">
                      {answer.split(' ').map((w, i) => (
                        <span key={i} data-fbw-word>
                          {w}{' '}
                        </span>
                      ))}
                    </p>

                    <div className="fs-fbwin__chart" data-fbw-tail>
                      <p className="fs-fbwin__charttitle">Engine-on idling, last 7 days</p>
                      {IDLE.map((d) => (
                        <div className="fs-fbwin__row" key={d.plate}>
                          <span className="fs-fbwin__who">
                            {d.name}
                            <em>{d.plate}</em>
                          </span>
                          <span className="fs-fbwin__track">
                            <i data-fbw-bar style={{ width: `${(d.hours / 3.2) * 100}%` }} />
                          </span>
                          <span className="fs-fbwin__val">{d.hours.toFixed(1)} h</span>
                        </div>
                      ))}
                    </div>

                    <p className="fs-fbwin__text" data-fbw-tail>
                      Most of it was at Wuse Market, 13:00–14:30 on Tuesday and Thursday. A shaded
                      park-and-wait spot would cut it without changing the route.
                    </p>

                    <div className="fs-fbwin__action" data-fbw-action>
                      <p className="fs-fbwin__actionhead">
                        <MessageSquareText className="h-3.5 w-3.5" /> Draft message to Aisha Bello
                        <span>Waiting for approval</span>
                      </p>
                      <p className="fs-fbwin__actionbody">
                        Hi Aisha, the tracker shows the engine running for about 3 hours while parked
                        at Wuse Market this week. Please switch off when waiting more than a few
                        minutes. Thank you.
                      </p>
                      <div className="fs-fbwin__actionbtns">
                        <span className="is-primary">
                          <Check className="h-3 w-3" /> Approve and send
                        </span>
                        <span>Edit</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="fs-fbwin__composer">
                <span>Ask about your drivers, vehicles, fuel or alerts…</span>
                <i>
                  <ArrowUp className="h-3.5 w-3.5" />
                </i>
              </div>
            </div>
          </div>
        </div>
        <p className="fs-fbshow__note">
          Illustrative conversation. Answers are drawn from each fleet’s own tracker and receipt
          data; every fleet gets 1,000 credits a month.
        </p>
      </div>
    </div>
  );
}
