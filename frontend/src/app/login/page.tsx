'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
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
