'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { api, Customer, isAuthenticated } from '@/lib/api';
import { HeroDashboard } from '@/components/marketing/HeroDashboard';
import { LiveMapDemo } from '@/components/marketing/LiveMapDemo';
import { FuelMath } from '@/components/marketing/FuelMath';
import { MarketingFooter, MarketingNav } from '@/components/marketing/MarketingChrome';
import { DrivingEvents } from '@/components/marketing/DrivingEvents';
import { FuelBrainShowcase } from '@/components/marketing/FuelBrainShowcase';
import { BlindSpot } from '@/components/marketing/BlindSpot';
import { HardwareSignal } from '@/components/marketing/HardwareSignal';
import { ReceiptJourney } from '@/components/marketing/ReceiptJourney';
import { DashboardShowcase } from '@/components/marketing/DashboardShowcase';
import { BellRing, Clock3, MapPinned, Route as RouteIcon } from 'lucide-react';
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
          <h2 className="fs-h2" data-reveal>
            Between two fill-ups, a fleet runs <em>blind</em>.
          </h2>
          <div>
            <p className="fs-body" data-reveal>
              You know what you paid at the pump. You do not know how far that fuel took the
              vehicle, how much of it burned standing still with the engine running, or which
              driver&rsquo;s day it went into. Every argument becomes one person&rsquo;s word against
              another&rsquo;s.
            </p>
            <p className="fs-body" style={{ marginTop: '1rem' }} data-reveal>
              FuelSense replaces that with a record. Scroll, and watch the week between two receipts
              fill in.
            </p>
          </div>
        </div>

        <BlindSpot />

        <div className="fs-stats fs-stats--row" data-reveal>
          <div className="fs-stat">
            <p className="fs-stat__value fs-mono" data-count="1300" data-prefix="₦">
              ₦0
            </p>
            <p className="fs-stat__label">Per litre, and moving</p>
            <p className="fs-stat__note">
              Each litre is valued at the price in force the day it burned, so last month never
              changes when today&rsquo;s price does.
            </p>
          </div>
          <div className="fs-stat">
            <p className="fs-stat__value fs-mono" data-count="0.9" data-decimals="1" data-suffix=" L/h">
              0 L/h
            </p>
            <p className="fs-stat__label">Burned going nowhere</p>
            <p className="fs-stat__note">
              A typical petrol engine idling: fuel spent on zero kilometres, invisible on a fuel card
              statement.
            </p>
          </div>
          <div className="fs-stat">
            <p className="fs-stat__value fs-mono">0</p>
            <p className="fs-stat__label">Sensors in the fuel line or tank</p>
            <p className="fs-stat__note">
              One tracker wired to power and ignition, and the receipts you already collect.
            </p>
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

      {/* hardware -------------------------------------------------------- */}
      <section className="fs-shell fs-section" id="hardware">
        <Marker num="06" label="The hardware" />
        <h2 className="fs-h2" data-reveal>
          One device. Every record, <em>accounted</em> for.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          A Teltonika FMC150 behind the dash, wired to power and ignition. This is the path one
          record takes, from the vehicle to the screen.
        </p>

        <HardwareSignal />

        <ol className="fs-rj__steps" style={{ marginTop: '1.5rem' }}>
          {[
            { icon: RouteIcon, name: 'Trips, segmented automatically', body: 'A trip opens with the ignition and closes after 30 minutes at rest. Distance is odometer-validated; GPS jitter and impossible hops are rejected.' },
            { icon: MapPinned, name: 'Stops that have names', body: 'Any halt over three minutes becomes a stop with a place name, so a route reads as a sequence of places rather than coordinates.' },
            { icon: Clock3, name: 'Idling, in naira', body: 'Engine on and standing still, counted to the minute and priced. The most common invisible cost in a fleet, and the easiest to fix.' },
            { icon: BellRing, name: 'Alerts that stay honest', body: 'Tracker unplugged, movement without ignition, a stop at a fuel station. Each is a flag with the evidence attached, never a verdict.' },
          ].map(({ icon: Icon, name, body }, i) => (
            <li key={name} data-reveal>
              <span className="fs-rj__stepicon">
                <Icon className="h-4 w-4" />
              </span>
              <span className="fs-rj__stepnum">{String(i + 1).padStart(2, '0')}</span>
              <p className="fs-rj__steptitle">{name}</p>
              <p className="fs-small">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 06. receipts and reconciliation -------------------------------- */}
      <section className="fs-shell fs-section" id="receipts">
        <Marker num="07" label="Receipts and reconciliation" />
        <h2 className="fs-h2" data-reveal>
          What was burned, against what was <em>bought</em>.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem' }} data-reveal>
          There is no sensor in your tank, so FuelSense never claims to have watched fuel leave it.
          A receipt is the one fuel figure that is fact. It is credited as money paid and set beside
          the burn modelled from the vehicle&rsquo;s movement, so a gap is a specific number on a
          specific day to ask about.
        </p>

        <ReceiptJourney />
      </section>

      {/* 07. dashboard -------------------------------------------------- */}
      <section className="fs-shell fs-section" id="dashboard">
        <Marker num="08" label="Inside the dashboard" />
        <h2 className="fs-h2" data-reveal>
          The numbers, and <em>how</em> they were reached.
        </h2>
        <p className="fs-body" style={{ marginTop: '1.25rem', marginBottom: '2.5rem' }} data-reveal>
          Every figure shows its working. This is the screen a manager lands on each morning.
        </p>

        <DashboardShowcase />

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
