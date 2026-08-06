'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FamilyAuthCard } from '@/components/family/FamilyAuthCard';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { familyLogin } from '@/lib/familyClient';
import { sanitizeFamilyRedirectPath } from '@/lib/auth/redirect';
import styles from '@/components/family/FamilyAuthCard.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). A Client Component
 * form posting via `fetch` to `POST /api/family/login`, deliberately not
 * a Server Action — unlike `app/login/page.tsx`, no staff `/api/auth/login`
 * Route Handler precedent exists to mirror there (only a Server Action),
 * while `POST /api/auth/accept-invitation`'s own Route Handler shape is
 * the closer analog for a token/credential-verifying, session-minting
 * endpoint on this mobile-first, fetch-driven surface. Never distinguishes
 * "no such email" from "wrong password" in its error message — the server
 * itself already collapses both to one generic response.
 */
const NOTICE_MESSAGES: Record<string, string> = {
  password_reset: 'Your password has been reset. Please sign in.',
};

function FamilyLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeFamilyRedirectPath(searchParams.get('next'));
  const notice = searchParams.get('notice');
  const noticeMessage = notice ? NOTICE_MESSAGES[notice] : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await familyLogin({ email, password });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  return (
    <FamilyAuthCard title="Family Portal" subtitle="Sign in to view your case." error={error} success={!error ? noticeMessage : null}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="family-login-email">
          Email
          <TextField id="family-login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
        </label>
        <label className={styles.label} htmlFor="family-login-password">
          Password
          <TextField
            id="family-login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <Button type="submit" disabled={pending || !email.trim() || !password}>
          {pending ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
      <p className={styles.hint}>
        <a className={styles.hintLink} href="/family/forgot-password">
          Forgot password?
        </a>
      </p>
    </FamilyAuthCard>
  );
}

export default function FamilyLoginPage() {
  return (
    <Suspense>
      <FamilyLoginForm />
    </Suspense>
  );
}
