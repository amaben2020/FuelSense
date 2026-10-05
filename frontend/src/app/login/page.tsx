'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, AuthResponse, setToken } from '@/lib/api';
import { AuthError, AuthFooter, AuthLayout, AuthSubmit, Field, inputClass } from '@/components/AuthLayout';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const router = useRouter();
  const cacheCustomer = useAuthStore((s) => s.setCustomer);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);

  // Where the emailed confirmation link lands. Read from location rather than
  // useSearchParams so the statically exported page needs no Suspense boundary.
  useEffect(() => {
    setVerified(new URLSearchParams(window.location.search).get('verified'));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      // The account is known the moment sign-in succeeds, so the loading
      // screen that follows can wear its name and mark rather than the
      // product's until /auth/me answers.
      cacheCustomer(data.customer);
      router.push(
        data.customer.onboarding_completed ? '/dashboard' : '/onboarding'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in to your"
      accent="fleet"
      subtitle="Every litre, every kilometre and every receipt, in one place."
    >
      <form onSubmit={handleSubmit}>
        {verified === 'ok' && (
          <p role="status" className="mb-4 rounded-lg border border-good/40 bg-good/10 px-3 py-2.5 text-sm text-good">
            Email confirmed. Sign in to continue.
          </p>
        )}
        {(verified === 'expired' || verified === 'invalid') && (
          <AuthError>
            {verified === 'expired'
              ? 'That link has expired. Sign in and use "Resend link" on the dashboard.'
              : 'That confirmation link is not valid. Sign in to request a new one.'}
          </AuthError>
        )}
        {error && <AuthError>{error}</AuthError>}

        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@company.com"
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Your password"
          />
        </Field>

        <AuthSubmit loading={loading} loadingLabel="Signing in…">
          Sign in
        </AuthSubmit>
      </form>

      <AuthFooter>
        No account? <Link href="/register">Create one</Link>
      </AuthFooter>
    </AuthLayout>
  );
}
