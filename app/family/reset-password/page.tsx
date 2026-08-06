'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FamilyAuthCard } from '@/components/family/FamilyAuthCard';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { familyResetPassword } from '@/lib/familyClient';
import styles from '@/components/family/FamilyAuthCard.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). On success, every
 * existing `PortalSession` for this user was revoked server-side
 * ("sign out everywhere") — this page sends the user to `/family/login`
 * to sign back in with the new password, never straight to the dashboard.
 */
function ResetPasswordForm() {
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
      await familyResetPassword({ token, password });
      router.push('/family/login?notice=password_reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  if (!token) {
    return (
      <FamilyAuthCard title="Family Portal" error="This password reset link is invalid or has expired.">
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/family/forgot-password">
            Request a new link
          </a>
        </p>
      </FamilyAuthCard>
    );
  }

  return (
    <FamilyAuthCard title="Set a new password" error={error}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="reset-password-password">
          New password
          <TextField id="reset-password-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
        </label>
        <label className={styles.label} htmlFor="reset-password-confirm">
          Confirm password
          <TextField
            id="reset-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </label>
        <Button type="submit" disabled={pending || !password || !confirmPassword}>
          {pending ? 'Saving…' : 'Reset Password'}
        </Button>
      </form>
    </FamilyAuthCard>
  );
}

export default function FamilyResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
