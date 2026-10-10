'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Menu, X } from 'lucide-react';
import { isAuthenticated } from '@/lib/api';
import { BrandMark } from '@/components/BrandMark';

// The token lives in browser storage, so the server has nothing to render from.
// useSyncExternalStore gives the server a definite "signed out" snapshot and
// lets the client correct it on hydration, without a state-setting effect.
const noopSubscribe = () => () => {};

const LINKS = [
  { href: '/#live', id: 'live', label: 'Live monitoring' },
  { href: '/#fuelbrain', id: 'fuelbrain', label: 'FuelBrain' },
  { href: '/#how', id: 'how', label: 'How it works' },
  { href: '/#receipts', id: 'receipts', label: 'Receipts' },
  { href: '/pricing', id: 'pricing', label: 'Pricing' },
  { href: '/contact', id: 'contact', label: 'Contact' },
];

/**
 * A floating pill rather than a full-width bar.
 *
 * Scroll drives it: past the hero it tightens, the wordmark folds into the
 * mark, and a ring around the mark fills with page progress. A lime pill
 * slides beneath whichever section is on screen, and follows the pointer
 * while it hovers the links. Off the landing page the active link is the
 * page itself (Pricing, Contact).
 */
export function MarketingNav() {
  const signedIn = useSyncExternalStore(noopSubscribe, () => isAuthenticated(), () => false);
  const pill = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLElement>(null);
  const glide = useRef<HTMLSpanElement>(null);
  const [section, setSection] = useState<string | null>(null);
  const path = useSyncExternalStore(noopSubscribe, () => window.location.pathname.replace(/\/$/, ''), () => '');
  const active = section ?? (path === '/pricing' ? 'pricing' : path === '/contact' ? 'contact' : null);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Which landing section is on screen.
  useEffect(() => {
    const targets = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[];
    if (!targets.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setSection(visible.target.id);
      },
      { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.25, 0.5] }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  // Scroll morph and the progress ring, as CSS variables the stylesheet reads.
  useEffect(() => {
    const el = pill.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const morph = ScrollTrigger.create({
      start: 0,
      end: 260,
      onUpdate: (self) => el.style.setProperty('--nav-k', reduced ? String(Math.round(self.progress)) : self.progress.toFixed(3)),
    });
    const ring = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => el.style.setProperty('--nav-p', self.progress.toFixed(4)),
    });
    return () => {
      morph.kill();
      ring.kill();
    };
  }, []);

  // The glide pill under the hovered or active link.
  useLayoutEffect(() => {
    const nav = linksRef.current;
    const g = glide.current;
    if (!nav || !g) return;
    const key = hover ?? active;
    const target = key ? nav.querySelector<HTMLElement>(`[data-nav="${key}"]`) : null;
    if (!target) {
      gsap.to(g, { opacity: 0, duration: 0.25 });
      return;
    }
    const n = nav.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    gsap.to(g, {
      x: r.left - n.left,
      width: r.width,
      opacity: 1,
      duration: 0.45,
      ease: 'expo.out',
    });
  }, [hover, active]);

  return (
    <header className="fs-nav">
      <div ref={pill} className={`fs-nav__pill ${open ? 'is-open' : ''}`}>
        <Link href="/" className="fs-wordmark" aria-label="FuelSense home">
          <span className="fs-nav__ring" aria-hidden>
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" className="fs-nav__ringtrack" />
              <circle cx="18" cy="18" r="16" className="fs-nav__ringfill" pathLength={1} />
            </svg>
            <BrandMark className="fs-wordmark__mark" strokeWidth={4.5} />
          </span>
          <span className="fs-nav__word">FuelSense</span>
        </Link>

        <nav ref={linksRef} className="fs-navlinks" aria-label="Primary" onMouseLeave={() => setHover(null)}>
          <span ref={glide} className="fs-nav__glide" aria-hidden />
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-nav={link.id}
              className={`fs-navlink ${active === link.id ? 'is-active' : ''}`}
              onMouseEnter={() => setHover(link.id)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="fs-nav__actions">
          {signedIn ? (
            <Link href="/dashboard" className="fs-nav__cta">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="fs-navlink fs-nav__signin">
                Sign in
              </Link>
              <Link href="/register" className="fs-nav__cta">
                Get started
              </Link>
            </>
          )}
          <button
            type="button"
            className="fs-nav__menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>

        {open && (
          <nav className="fs-nav__sheet" aria-label="Menu">
            {LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="fs-footer">
      <div className="fs-shell fs-footer__inner">
        <div>
          <Link href="/" className="fs-wordmark">
            <BrandMark className="fs-wordmark__mark" strokeWidth={4.5} />
            FuelSense
          </Link>
          <p className="fs-small" style={{ marginTop: '0.5rem', maxWidth: '32ch' }}>
            Fuel intelligence for Nigerian fleets. Built on GPS telemetry.
          </p>
        </div>

        <nav
          aria-label="Footer"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}
        >
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="fs-navlink">
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="fs-navlink">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
