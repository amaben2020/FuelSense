'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import '@/app/marketing.css';

// Signing in should not feel like leaving the product you were just reading
// about. This carries the marketing surface through: the same near-black
// paper, the serif for the one headline, the monospace on field labels.
//
// The serif is a display face and only holds up large. Everything smaller
// than the headline — the wordmark, the fact headings, the body — is set in
// the sans, because at seventeen pixels the serif reads as a fallback font
// and the page looks broken rather than designed.

export const inputClass = 'fs-input fs-auth__input';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="fs-auth__field">
      <span className="fs-auth__label">
        {label}
        {hint && <span className="fs-auth__hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="fs-auth__error">
      <span className="fs-auth__error-dot" aria-hidden />
      {children}
    </p>
  );
}

export function AuthSubmit({
  loading,
  children,
  loadingLabel,
}: {
  loading: boolean;
  children: React.ReactNode;
  loadingLabel: string;
}) {
  return (
    <button type="submit" disabled={loading} className="fs-auth__submit">
      <span>{loading ? loadingLabel : children}</span>
      {!loading && (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <path
            d="M4 10h11m-4-4 4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="fs-auth__footer">{children}</p>;
}

const REASSURANCE: Array<[string, string]> = [
  ['One vehicle is enough to start', 'No minimum fleet size, and no licence to buy up front.'],
  [
    'Bring your own trackers',
    'Already running FMC150s? We configure them and charge for the software only.',
  ],
  ['Your data stays yours', 'Telemetry belongs to your account, and you can export it whenever.'],
];

export function AuthLayout({
  title,
  accent,
  subtitle,
  children,
}: {
  title: string;
  /** The word set in the italic serif, lemon — "Sign in to your *fleet*". */
  accent?: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fs-landing fs-auth">
      <div className="fs-auth__atmosphere" aria-hidden />

      <header className="fs-auth__bar">
        <Link href="/" className="fs-auth__wordmark">
          <BrandMark className="fs-wordmark__mark" strokeWidth={4.5} />
          <span>FuelSense</span>
        </Link>
        <span className="fs-auth__status">
          <span className="fs-auth__status-dot" />
          Fleet monitoring · Nigeria
        </span>
      </header>

      <div className="fs-shell fs-auth__grid">
        <section className="fs-auth__intro">
          <h1 className="fs-auth__title">
            {title}
            {accent && (
              <>
                {' '}
                <em>{accent}</em>
              </>
            )}
          </h1>
          <p className="fs-auth__lede">{subtitle}</p>

          <ul className="fs-auth__facts">
            {REASSURANCE.map(([heading, body], i) => (
              <li className="fs-auth__fact" key={heading} style={{ animationDelay: `${180 + i * 90}ms` }}>
                <span className="fs-auth__fact-index">0{i + 1}</span>
                <div>
                  <h2 className="fs-auth__fact-name">{heading}</h2>
                  <p className="fs-auth__fact-body">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="fs-auth__card" aria-label={title}>
          {children}
        </section>
      </div>
    </div>
  );
}
