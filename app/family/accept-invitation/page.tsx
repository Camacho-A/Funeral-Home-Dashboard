'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FamilyAuthCard } from '@/components/family/FamilyAuthCard';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { familyAcceptInvitation } from '@/lib/familyClient';
import styles from '@/components/family/FamilyAuthCard.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). The token is a
 * `?token=` query param on this page's own URL — the link the invitation
 * email sends. Sets a password (this is also the moment a `PortalUser`
 * first gets a real password), then signs the new session in immediately.
 * The server never distinguishes invalid/expired/already-used — this page
 * shows the same generic message for all three.
 */
function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await familyAcceptInvitation({ token, password });
      router.push('/family/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  if (!token) {
    return (
      <FamilyAuthCard title="Family Portal" error="This invitation link is invalid or has expired.">
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/family/login">
            Return to sign in
          </a>
        </p>
      </FamilyAuthCard>
    );
  }

  return (
    <FamilyAuthCard title="Welcome" subtitle="Create a password to access the Family Portal." error={error}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="accept-invitation-password">
          Password
          <TextField
            id="accept-invitation-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="new-password"
          />
        </label>
        <label className={styles.label} htmlFor="accept-invitation-confirm-password">
          Confirm password
          <TextField
            id="accept-invitation-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </label>
        <Button type="submit" disabled={pending || !password || !confirmPassword}>
          {pending ? 'Setting up…' : 'Continue'}
        </Button>
      </form>
    </FamilyAuthCard>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitationForm />
    </Suspense>
  );
}
