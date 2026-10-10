'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { api, Customer, isAuthenticated } from '@/lib/api';
import { HeroDashboard } from '@/components/marketing/HeroDashboard';
import { LiveMapDemo } from '@/components/marketing/LiveMapDemo';
import { ReconcileFlow } from '@/components/marketing/ReconcileFlow';
import { FuelMath } from '@/components/marketing/FuelMath';
import { MarketingFooter, MarketingNav } from '@/components/marketing/MarketingChrome';
import { HaulixShowcase } from '@/components/marketing/HaulixShowcase';
import { DrivingEvents } from '@/components/marketing/DrivingEvents';
import { FuelBrainShowcase } from '@/components/marketing/FuelBrainShowcase';
import { countUp, revealOnScroll, useGsapScope } from '@/components/marketing/useScrollReveal';
import './marketing.css';

function Marker({ num, label }: { num: string; label: string }) {
  return (
    <div className="fs-marker">
      <span className="fs-marker__num">{num}</span>
      <span className="fs-marker__rule" data-rule />
      <span className="fs-marker__label">{label}</span>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();

  // Someone already signed in has no use for the pitch, so send them where they
  // were going. Visitors without a token never touch this and see the page.
  // The landing renders while the check runs, so there is no loading screen
  // and no flash of blank page for the far more common signed-out case.
  useEffect(() => {
    if (!isAuthenticated()) return;

    let cancelled = false;
    api<Customer>('/auth/me')
      .then((me) => {
        if (!cancelled) router.replace(me.onboarding_completed ? '/dashboard' : '/onboarding');
      })
      // A stale or rejected token just means "treat them as a visitor".
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [router]);

  const scope = useGsapScope(({ scope }) => {
    // Hero: lines rise out of their masks, then everything else settles in.
    gsap.from('[data-hero-line] > span', {
      yPercent: 115,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.09,
    });
    gsap.from('[data-hero-tail]', {
      opacity: 0,
      y: 20,
      duration: 0.9,
      ease: 'power3.out',
      delay: 0.45,
      stagger: 0.1,
    });
    gsap.from('[data-readout]', {
      opacity: 0,
      y: 40,
      scale: 0.97,
      duration: 1.1,
      ease: 'power3.out',
      delay: 0.3,
    });

    // Every section caption draws its own hairline as it arrives.
    gsap.utils.toArray<HTMLElement>('[data-rule]', scope).forEach((rule) => {
      gsap.from(rule, {
        scaleX: 0,
        duration: 1,
        ease: 'power3.inOut',
        scrollTrigger: { trigger: rule, start: 'top 90%', once: true },
      });
    });

    revealOnScroll('[data-reveal]', scope);

    // Headline figures count up rather than simply appearing.
    gsap.utils.toArray<HTMLElement>('[data-count]', scope).forEach((el) => {
      const to = Number(el.dataset.count);
      const prefix = el.dataset.prefix ?? '';
      const suffix = el.dataset.suffix ?? '';
      const decimals = Number(el.dataset.decimals ?? 0);
      countUp(
        el,
        to,
        (value) =>
          `${prefix}${value.toLocaleString('en-NG', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })}${suffix}`
      );
    });

    // Step cards arrive at slightly different rates: depth without moving the
    // whole section, which would fight the reading rhythm.
    gsap.utils.toArray<HTMLElement>('[data-step]', scope).forEach((card, i) => {
      gsap.from(card, {
        opacity: 0,
        y: 60 + i * 14,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 88%', once: true },
      });
    });

    // Dashboard panels drift as they pass, so scrolling feels connected to the
    // thing being described.
    gsap.utils.toArray<HTMLElement>('[data-panel]', scope).forEach((panel) => {
      gsap.fromTo(
        panel,
        { y: 40 },
        {
          y: -20,
          ease: 'none',
          scrollTrigger: { trigger: panel, start: 'top bottom', end: 'bottom top', scrub: 0.8 },
        }
      );
    });
  });

  return (
    <div className="fs-landing" ref={scope}>
      <MarketingNav />

      {/* 01. hero ------------------------------------------------------ */}
      <section className="fs-shell fs-hero">
        <div className="fs-hero__grid">
          <div>
            <span className="fs-eyebrow" data-hero-tail>
              Fleet fuel intelligence · Nigeria
            </span>

            <h1 className="fs-display" style={{ marginTop: '1.5rem' }}>
              <span className="fs-reveal" data-hero-line>
                <span>See where your</span>
              </span>
              <span className="fs-reveal" data-hero-line>
                <span>
                  fuel <em>actually</em> goes.
                </span>
              </span>
            </h1>

            <p className="fs-lede" style={{ marginTop: '1.75rem' }} data-hero-tail>
              Fit a tracker to your vehicle and FuelSense shows you how far it drove, how long
              it sat idling with the engine running, roughly how much fuel that used, and what it
              cost in naira.
            </p>

            <div className="fs-hero__actions" data-hero-tail>
              <Link href="/register" className="fs-btn fs-btn--primary">
                Start tracking
              </Link>
              <Link href="/contact" className="fs-btn fs-btn--ghost">
                Talk to us about trackers
              </Link>
            </div>

            <p className="fs-small" style={{ marginTop: '1.25rem' }} data-hero-tail>
              Works with the Teltonika FMC150. No fuel sensor to install.
            </p>
          </div>

          <div data-readout>
            <HeroDashboard />
          </div>
        </div>
      </section>

      {/* trust ---------------------------------------------------------- */}
      <section className="fs-shell">
        <div className="fs-trust" data-reveal>
          {[
            ['Hardware', 'Teltonika FMC150, fitted in an hour'],
            ['Hosting', 'AWS eu-north-1, encrypted at rest'],
            ['Access', 'Manager and read-only viewer roles'],
            ['Method', 'Every figure shows its working'],
          ].map(([label, value]) => (
            <div className="fs-trust__item" key={label}>
              <p className="fs-trust__label">{label}</p>
              <p className="fs-trust__value">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 01. the problem ----------------------------------------------- */}
      <section className="fs-shell fs-section" id="problem">
        <Marker num="01" label="The problem" />
        <div className="fs-split">
          <div>
            <h2 className="fs-h2" data-reveal>
              Between two fill-ups, a fleet runs <em>blind</em>.
            </h2>
            <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
              You know what you paid at the pump. You do not know how far that fuel took the
              vehicle, how much of it burned standing still with the engine running, or which
              driver&rsquo;s day it went into. Every argument becomes one person&rsquo;s word against
              another&rsquo;s.
            </p>
            <p className="fs-body" style={{ marginTop: '1rem' }} data-reveal>
              FuelSense replaces that with a record: every trip, stop and idle minute from the
              tracker, set against the receipts your drivers file.
            </p>
          </div>

          <div className="fs-stats fs-stats--stack" data-reveal>
            <div className="fs-stat">
              <p className="fs-stat__value fs-mono" data-count="1300" data-prefix="₦">
                ₦0
              </p>
              <p className="fs-stat__label">Per litre, and moving</p>
              <p className="fs-stat__note">
                Pump prices change faster than receipts accumulate. Each litre is valued at the
                price in force the day it burned, so last month never changes when today&rsquo;s
                price does.
              </p>
            </div>
            <div className="fs-stat">
              <p className="fs-stat__value fs-mono" data-count="0.9" data-decimals="1" data-suffix=" L/h">
                0 L/h
              </p>
              <p className="fs-stat__label">Burned going nowhere</p>
              <p className="fs-stat__note">
                A typical petrol engine idling. Twenty minutes at a gate is fuel spent on zero
                kilometres, and invisible on a fuel card statement.
              </p>
            </div>
            <div className="fs-stat">
              <p className="fs-stat__value fs-mono">0</p>
              <p className="fs-stat__label">Sensors in the fuel line or tank</p>
              <p className="fs-stat__note">
                Nothing is spliced or drilled. Everything comes from one tracker wired to power and
                ignition, and the receipts you already collect.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 02. live monitoring ------------------------------------------- */}
      <section className="fs-shell fs-section" id="live">
        <Marker num="02" label="Live monitoring" />
        <h2 className="fs-h2" data-reveal>
          Watch a journey <em>account</em> for itself.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          Every vehicle sits on a live map with its trail behind it. Trips open and close from the
          ignition, stops are detected and given real addresses, and the tank drains in step with
          the distance. Scroll to drive the route.
        </p>

        <LiveMapDemo />
      </section>

      {/* 03. driver behaviour ------------------------------------------- */}
      <section className="fs-shell fs-section" id="behaviour">
        <Marker num="03" label="Driver behaviour" />
        <h2 className="fs-h2" data-reveal>
          Every flag points at a <em>second</em> you can watch.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          Harsh braking, harsh cornering and harsh acceleration are computed from the
          speed and heading the tracker already sends — no extra sensor, no
          accelerometer scenario to switch on. Declare a speed limit and sustained
          stretches above it are found the same way. The track is coloured by measured
          speed, so a flagged moment is something you can see in context rather than a
          label you have to trust.
        </p>

        <DrivingEvents />

        <p className="fs-small" style={{ marginTop: '1.75rem', maxWidth: '46rem' }} data-reveal>
          What is not here matters as much. Nothing on this page comes from an engine
          computer, because these trackers have no CAN or OBD link — so FuelSense does
          not claim engine load, RPM or a sensed fuel level. Every colour above is
          derived from position, speed and time, and the replay shows you the working.
        </p>
      </section>

      {/* 04. FuelBrain -------------------------------------------------- */}
      <section className="fs-shell fs-section" id="fuelbrain">
        <Marker num="04" label="FuelBrain" />
        <h2 className="fs-h2" data-reveal>
          Ask your fleet a <em>question</em>.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          FuelBrain is an assistant that works over your own fleet data. Ask in plain English who
          idled the most, what fuel cost last month, or which alerts need you today, and get an
          answer with the figures behind it.
        </p>

        <FuelBrainShowcase />
      </section>

      {/* 05. how it works ---------------------------------------------- */}
      <section className="fs-shell fs-section" id="how">
        <Marker num="05" label="How it works" />
        <h2 className="fs-h2" data-reveal>
          A tracker, satellites, and <em>arithmetic</em> you can audit.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem', marginBottom: '2.5rem' }} data-reveal>
          Nothing is spliced into the fuel line and there is no sensor in the tank. The work is done
          by a Teltonika FMC150 fitted to the vehicle, and by the satellite fixes it already
          collects.
        </p>

        <div className="fs-steps">
          <article className="fs-step" data-step>
            <span className="fs-step__index">Step 01</span>
            <h3 className="fs-h3">The tracker is fitted</h3>
            <p className="fs-small">
              An FMC150 wires into the vehicle&rsquo;s power and ignition. From that moment it
              reports position, speed, ignition and movement over the mobile network: every few
              seconds while driving, hourly at rest.
            </p>
            <div className="fs-step__figure">
              <p className="fs-small fs-mono" style={{ color: 'var(--green-700)' }}>
                AVL 239 · ignition
                <br />
                AVL 240 · movement
                <br />
                AVL 16 · odometer
              </p>
            </div>
          </article>

          <article className="fs-step" data-step>
            <span className="fs-step__index">Step 02</span>
            <h3 className="fs-h3">Distance and idling become litres</h3>
            <p className="fs-small">
              Odometer-validated distance is divided by the vehicle&rsquo;s rated economy: the
              official city figure for its model and year, or the rate you set. Engine-on minutes
              standing still are added at an idle burn rate.
            </p>
            <div className="fs-step__figure">
              <p className="fs-small fs-mono" style={{ color: 'var(--green-700)' }}>
                km ÷ km/L + idle h × L/h
                <br />
                AVL 16 · AVL 239 · AVL 24
              </p>
            </div>
          </article>

          <article className="fs-step" data-step>
            <span className="fs-step__index">Step 03</span>
            <h3 className="fs-h3">Litres become naira</h3>
            <p className="fs-small">
              Each litre is priced at the fuel price in force the day it burned. Receipts your
              drivers file are the money actually paid, kept separate from the estimate so the
              two can be compared, never blended.
            </p>
            <div className="fs-step__figure">
              <p className="fs-small fs-mono" style={{ color: 'var(--green-700)' }}>
                30.4 km ÷ 9.8 km/L = 3.1 L
                <br />3.1 L × ₦1,300 = ₦4,030
              </p>
            </div>
          </article>
        </div>

        {/* The AVL 12 explanation, stated plainly, beside the device itself */}
        <div
          className="fs-step"
          style={{ marginTop: '1.5rem', background: 'var(--paper-sunk)' }}
          data-reveal
        >
          <div className="fs-avl">
            <div>
              <span className="fs-step__index">Why we say &ldquo;modelled&rdquo;</span>
              <h3 className="fs-h3" style={{ maxWidth: '28ch', marginBlock: '0.5rem 0.875rem' }}>
                An estimate that admits it is one.
              </h3>
              <p className="fs-body">
                These trackers have no fuel sensor and no link to the engine computer. The
                device&rsquo;s own GNSS fuel counter was tested against real receipts and fell far
                short, so FuelSense does not rely on it. Litres are modelled from what the tracker
                does measure well: how far the vehicle went and how long the engine ran while it
                stood still.
              </p>
              <p className="fs-body">
                That is stated wherever litres appear as money. The only fuel figure treated as
                fact is a receipt, and receipts are shown as what was paid rather than folded into
                the estimate.
              </p>
              <p className="fs-body">
                Every trip also carries a <strong>confidence score</strong> with its reasons:
                sparse fixes, reporting gaps or a cold start without a GPS lock lower it. A manager
                can see at a glance which figures are solid and which are worth a second look.
              </p>
            </div>

            <FuelMath />
          </div>
        </div>
      </section>

      <HaulixShowcase />

      <section className="fs-shell">

        <div className="fs-featgrid" style={{ marginTop: '3rem' }}>
          {[
            {
              name: 'Trips, segmented automatically',
              body: 'A trip opens when the ignition turns and closes after 30 minutes at rest. Distance is odometer-validated, with GPS jitter and impossible hops rejected.',
            },
            {
              name: 'Stops that have names',
              body: 'Any halt over three minutes becomes a stop with a real address, so a route reads as a sequence of places rather than coordinates.',
            },
            {
              name: 'Idling, measured in naira',
              body: 'Engine on and stationary is tracked to the minute and priced. It is the most common invisible cost in a fleet, and the easiest to fix.',
            },
            {
              name: 'Alerts that stay honest',
              body: 'Low fuel, tracker unplugged, movement without ignition. Each is a flag for investigation with the evidence attached, never a verdict.',
            },
          ].map((feature) => (
            <div className="fs-feat" key={feature.name} data-reveal>
              <h3 className="fs-feat__name">{feature.name}</h3>
              <p className="fs-small">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 06. receipts and reconciliation -------------------------------- */}
      <section className="fs-shell fs-section" id="receipts">
        <Marker num="06" label="Receipts and reconciliation" />
        <h2 className="fs-h2" data-reveal>
          What was burned, against what was <em>bought</em>.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          There is no sensor in your tank, so FuelSense never claims to have watched fuel leave it.
          What it can do is measure the burn from the vehicle&rsquo;s own movement and set it beside
          the receipts your drivers upload. Where the two disagree, you have a specific number and a
          specific day to ask about.
        </p>

        <ReconcileFlow />

        <div className="fs-featgrid" style={{ marginTop: '3rem' }}>
          {[
            {
              name: 'Drivers upload from their phone',
              body: 'A photo of the pump slip at the forecourt. OCR reads the merchant, litres and amount, so nobody types figures into a spreadsheet a week later.',
            },
            {
              name: 'Matched to the tank automatically',
              body: 'A logged purchase is matched against the refuel the tracker saw at that time, then credited to the vehicle’s virtual tank.',
            },
            {
              name: 'The price you actually paid',
              body: 'Receipts set the real naira-per-litre for the day they cover, and every cost figure for that period is valued at it.',
            },
            {
              name: 'Calibration that improves with use',
              body: 'Each verified fill-up sharpens the vehicle’s consumption model, so the estimate stops being a class average and becomes this vehicle.',
            },
          ].map((feature) => (
            <div className="fs-feat" key={feature.name} data-reveal>
              <h3 className="fs-feat__name">{feature.name}</h3>
              <p className="fs-small">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 07. dashboard -------------------------------------------------- */}
      <section className="fs-shell fs-section" id="dashboard">
        <Marker num="07" label="Inside the dashboard" />
        <h2 className="fs-h2" data-reveal>
          The numbers, and <em>how</em> they were reached.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem', marginBottom: '2.5rem' }} data-reveal>
          Every figure shows its working. These are the panels you land on.
        </p>

        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <div className="fs-panel" data-panel>
            <p className="fs-panel__title">Operational snapshot</p>
            <p className="fs-panel__sub">What was paid, and the distance it bought</p>
            <div className="fs-panelgrid">
              <div className="fs-tile">
                <p className="fs-tile__label">Distance · 7d</p>
                <p className="fs-tile__value">286 km</p>
                <p className="fs-tile__note">14 trips over 6 days</p>
              </div>
              <div className="fs-tile">
                <p className="fs-tile__label">Bought · receipts</p>
                <p className="fs-tile__value fs-tile__value--good">₦52,000</p>
                <p className="fs-tile__note">40 L paid at the pump</p>
              </div>
              <div className="fs-tile">
                <p className="fs-tile__label">Idling</p>
                <p className="fs-tile__value fs-tile__value--warn">3h 40m</p>
                <p className="fs-tile__note">7.9 L burned</p>
              </div>
              <div className="fs-tile">
                <p className="fs-tile__label">Cost per km</p>
                <p className="fs-tile__value">₦133</p>
                <p className="fs-tile__note">modelled, at ₦1,300/L</p>
              </div>
            </div>
            <p className="fs-panel__sub" style={{ marginTop: '0.875rem' }}>
              Receipts lead: ₦52,000 is money that left someone&rsquo;s hands. The modelled burn
              (286 km ÷ 9.8 km/L plus 3h 40m idling, about 32.5 L) sits one click behind it.
            </p>
          </div>

          <div className="fs-panel" data-panel>
            <p className="fs-panel__title">Vehicle data</p>
            <p className="fs-panel__sub">
              Every signal the tracker sends, named and explained in plain words
            </p>
            <div style={{ marginTop: '0.875rem' }}>
              {[
                ['Total odometer', '81,802 km', '16'],
                ['Speed', '54 km/h', '24'],
                ['GNSS status', 'Fix · good', '69'],
                ['Ignition', 'On', '239'],
                ['Movement', 'Moving', '240'],
                ['GSM signal strength', '4 / 5 · MTN', '21'],
              ].map(([label, value, avl]) => (
                <div className="fs-row" key={avl}>
                  <span>{label}</span>
                  <span>
                    <span className="fs-row__value">{value}</span>{' '}
                    <span className="fs-row__muted fs-mono" style={{ fontSize: '0.6875rem' }}>
                      AVL {avl}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="fs-panel" data-panel>
            <p className="fs-panel__title">Efficiency and driving behaviour</p>
            <p className="fs-panel__sub">Per vehicle and per driver, against a realistic baseline</p>
            <div style={{ marginTop: '0.875rem' }}>
              {[
                { label: 'LAG-001-FS · Benneth', mid: '286 km · 14 trips', right: '₦133/km', warn: false },
                { label: 'Harsh braking', mid: 'this week', right: '4 events', warn: true },
                { label: 'Idling', mid: '3h 40m engine-on, stationary', right: '₦10,500', warn: true },
                { label: 'Driver score', mid: 'against fleet baseline', right: '92 / 100', warn: false },
              ].map((row) => (
                <div className="fs-row" key={row.label}>
                  <span>{row.label}</span>
                  <span className="fs-row__muted">{row.mid}</span>
                  <span
                    className="fs-row__value"
                    style={{ color: row.warn ? '#ffb95f' : '#00e599' }}
                  >
                    {row.right}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="fs-small" style={{ marginTop: '1.5rem' }} data-reveal>
          Also inside: trip history with exact date ranges, fuel-level charts with idling shaded,
          event replay, driver receipt uploads read by OCR, and email alerts you choose.
        </p>
      </section>

      {/* 08. cta -------------------------------------------------------- */}
      <section className="fs-shell fs-section" style={{ borderTop: 0 }}>
        <div className="fs-cta" data-reveal>
          <h2 className="fs-h2">
            Find out what your fleet <em>actually</em> costs.
          </h2>
          <p className="fs-lede" style={{ marginTop: '1.25rem' }}>
            Start with one vehicle. We supply and configure the Teltonika hardware, or work with
            trackers you already run.
          </p>
          <div className="fs-hero__actions">
            <Link
              href="/contact"
              className="fs-btn"
              style={{ background: 'var(--green-electric)', color: '#04231a' }}
            >
              Talk to us
            </Link>
            <Link
              href="/register"
              className="fs-btn fs-btn--ghost"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
