'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ArrowRight, Check, Loader2, Mail } from 'lucide-react';
import { MarketingFooter, MarketingNav } from '@/components/marketing/MarketingChrome';
import { useGsapScope } from '@/components/marketing/useScrollReveal';
import { api } from '@/lib/api';
import '../marketing.css';

const TOPICS = [
  { value: 'trackers', label: 'Buy trackers' },
  { value: 'setup', label: 'Set up my fleet' },
  { value: 'demo', label: 'See a demo' },
  { value: 'other', label: 'Something else' },
];

const SIZES = ['1–5', '6–20', '21–50', '50+'];

const NEXT = [
  { title: 'We read it and reply', body: 'A person answers, by email or a call if you leave a number.' },
  { title: 'We scope your fleet', body: 'Vehicles, routes, drivers, and whether you already run trackers.' },
  { title: 'Hardware, configured', body: 'Professional-grade trackers set up for your vehicles before they ship, or your existing units connected.' },
  { title: 'First vehicle reporting', body: 'Account, drivers and fuel price set up with you. You see the first trip the same day it is driven.' },
];

const CONTACT_EMAIL = 'uzochukwubenamara@gmail.com';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; name: string } | { kind: 'error'; message: string };

function AbujaClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="fs-cx__clock">{now ?? '--:--'} in Abuja (WAT)</span>;
}

export default function ContactPage() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [topic, setTopic] = useState('trackers');
  const [size, setSize] = useState<string | null>(null);
  const [filled, setFilled] = useState({ name: false, email: false, message: false });
  const card = useRef<HTMLDivElement>(null);
  const ready = [true, filled.name, filled.email, filled.message].filter(Boolean).length;

  // Pills lean toward the pointer, then spring back.
  useEffect(() => {
    const el = card.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pills = Array.from(el.querySelectorAll<HTMLElement>('.fs-cx__pill'));
    const off = pills.map((pill) => {
      const qx = gsap.quickTo(pill, 'x', { duration: 0.4, ease: 'power3.out' });
      const qy = gsap.quickTo(pill, 'y', { duration: 0.4, ease: 'power3.out' });
      const move = (e: PointerEvent) => {
        const r = pill.getBoundingClientRect();
        qx((e.clientX - (r.left + r.width / 2)) * 0.25);
        qy((e.clientY - (r.top + r.height / 2)) * 0.35);
      };
      const leave = () => {
        qx(0);
        qy(0);
      };
      pill.addEventListener('pointermove', move);
      pill.addEventListener('pointerleave', leave);
      return () => {
        pill.removeEventListener('pointermove', move);
        pill.removeEventListener('pointerleave', leave);
      };
    });
    return () => off.forEach((f) => f());
  }, [status.kind]);

  // The completion meter eases to its new length.
  useEffect(() => {
    const bar = card.current?.querySelector<HTMLElement>('[data-cx-meter]');
    if (bar) gsap.to(bar, { scaleX: ready / 4, duration: 0.6, ease: 'expo.out' });
  }, [ready]);

  const scope = useGsapScope(() => {
    gsap.from('[data-contact-line] > span', { yPercent: 115, duration: 1, ease: 'expo.out', stagger: 0.08 });
    gsap.from('[data-contact-reveal]', { opacity: 0, y: 24, duration: 0.8, ease: 'power3.out', delay: 0.3, stagger: 0.08 });
    gsap.from('[data-cx-step]', { opacity: 0, x: -16, duration: 0.6, ease: 'power3.out', delay: 0.55, stagger: 0.1 });
    gsap.from('[data-cx-rail]', { scaleY: 0, transformOrigin: 'top center', duration: 1.2, ease: 'power3.inOut', delay: 0.5 });
    gsap.from('[data-cx-in]', { opacity: 0, y: 18, filter: 'blur(6px)', duration: 0.7, ease: 'power3.out', delay: 0.45, stagger: 0.07, clearProps: 'filter' });
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({ kind: 'sending' });
    try {
      await api('/contact', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          company: data.get('company'),
          phone: data.get('phone'),
          fleet_size: size ? `${size} vehicles` : '',
          topic,
          message: data.get('message'),
        }),
      });
      setStatus({ kind: 'sent', name: String(data.get('name') ?? '').split(' ')[0] });
      form.reset();
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not send your message. Please try again.',
      });
    }
  };

  return (
    <div className="fs-landing" ref={scope}>
      <MarketingNav />

      <section className="fs-shell fs-hero">
        <div className="fs-cx">
          <div className="fs-cx__left">
            <span className="fs-eyebrow" data-contact-reveal>
              Contact
            </span>

            <h1 className="fs-display" style={{ marginTop: '1.5rem', fontSize: 'clamp(2.5rem, 6vw, 4.75rem)' }}>
              <span className="fs-reveal" data-contact-line>
                <span>Let&rsquo;s get your</span>
              </span>
              <span className="fs-reveal" data-contact-line>
                <span>
                  fleet <em>measured</em>.
                </span>
              </span>
            </h1>

            <p className="fs-lede" style={{ marginTop: '1.5rem' }} data-contact-reveal>
              Tell us what you run and what you need. We supply and configure the hardware, set up
              your account, and stay until the first vehicle is reporting.
            </p>

            <div className="fs-cx__next" data-contact-reveal>
              <p className="fs-cx__nexthead">What happens next</p>
              <ol>
                <span className="fs-cx__rail" data-cx-rail aria-hidden />
                {NEXT.map((step, i) => (
                  <li key={step.title} data-cx-step>
                    <span className="fs-cx__dot">{i + 1}</span>
                    <div>
                      <p className="fs-cx__steptitle">{step.title}</p>
                      <p className="fs-small">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <a href={`mailto:${CONTACT_EMAIL}`} className="fs-cx__direct" data-contact-reveal>
              <span className="fs-cx__directicon">
                <Mail className="h-4 w-4" />
              </span>
              <span>
                <span className="fs-cx__directlabel">Prefer email?</span>
                <span className="fs-cx__directvalue">{CONTACT_EMAIL}</span>
              </span>
              <AbujaClock />
            </a>
          </div>

          <div className="fs-cx__card" ref={card} data-contact-reveal>
            <span className="fs-cx__orbit" aria-hidden />
            {status.kind === 'sent' ? (
              <div className="fs-cx__done" role="status">
                <span className="fs-cx__check">
                  <Check className="h-7 w-7" />
                </span>
                <h2 className="fs-h3">Thank you{status.name ? `, ${status.name}` : ''}.</h2>
                <p className="fs-body">
                  Your message has reached us and a person will reply. While you wait, the
                  documentation shows exactly how every figure is worked out.
                </p>
                <div className="fs-cx__doneactions">
                  <a href="/documentation" className="fs-cx__send">
                    Read the method <ArrowRight className="h-4 w-4" />
                  </a>
                  <button type="button" className="fs-cx__ghost" onClick={() => setStatus({ kind: 'idle' })}>
                    Send another
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={submit}
                onInput={(e) => {
                  const f = e.currentTarget;
                  const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? '';
                  setFilled({
                    name: val('name').length > 1,
                    email: /.+@.+\..+/.test(val('email')),
                    message: val('message').length > 9,
                  });
                }}
              >
                <div className="fs-cx__meterrow" data-cx-in>
                  <span>Your enquiry</span>
                  <span className="fs-cx__meternum">{ready} of 4 ready</span>
                </div>
                <div className="fs-cx__meter" data-cx-in>
                  <i data-cx-meter />
                  {[1, 2, 3].map((n) => (
                    <b key={n} style={{ left: `${n * 25}%` }} />
                  ))}
                </div>
                <fieldset className="fs-cx__group" data-cx-in>
                  <legend>What do you need?</legend>
                  <div className="fs-cx__pills">
                    {TOPICS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={topic === t.value}
                        onClick={() => setTopic(t.value)}
                        className="fs-cx__pill"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="fs-cx__group" data-cx-in>
                  <legend>How many vehicles?</legend>
                  <div className="fs-cx__pills">
                    {SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={size === s}
                        onClick={() => setSize(size === s ? null : s)}
                        className="fs-cx__pill fs-cx__pill--mono"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="fs-cx__grid" data-cx-in>
                  {[
                    { name: 'name', label: 'Your name', required: true, max: 120 },
                    { name: 'email', label: 'Work email', type: 'email', required: true },
                    { name: 'company', label: 'Company', max: 120 },
                    { name: 'phone', label: 'Phone', type: 'tel', max: 40 },
                  ].map((f) => (
                    <label key={f.name} className="fs-cx__field">
                      <input
                        name={f.name}
                        type={f.type ?? 'text'}
                        required={f.required}
                        maxLength={f.max}
                        placeholder=" "
                        className="fs-cx__input"
                      />
                      <span className="fs-cx__label">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </span>
                    </label>
                  ))}
                </div>

                <label className="fs-cx__field fs-cx__field--area" data-cx-in>
                  <textarea name="message" required maxLength={4000} placeholder=" " className="fs-cx__input" rows={5} />
                  <span className="fs-cx__label">What do you run, and what are you trying to find out? *</span>
                </label>

                {status.kind === 'error' && (
                  <p className="fs-note fs-note--bad" style={{ marginTop: '1rem' }} role="alert">
                    {status.message}
                  </p>
                )}

                <button
                  type="submit"
                  className={`fs-cx__send fs-cx__send--full ${status.kind === 'sending' ? 'is-sending' : ''}`}
                  disabled={status.kind === 'sending'}
                >
                  {status.kind === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending
                    </>
                  ) : (
                    <>
                      Send enquiry <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                <p className="fs-cx__fine">We use your details only to reply to this enquiry.</p>
              </form>
            )}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
