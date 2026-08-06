'use client';

import { useState } from 'react';
import { FamilyAuthCard } from '@/components/family/FamilyAuthCard';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { familyForgotPassword } from '@/lib/familyClient';
import styles from '@/components/family/FamilyAuthCard.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Always shows the
 * same generic success message regardless of whether the email belongs to
 * a real `PortalUser` — the server's own response is equally generic
 * (`{ ok: true }` either way), so this page has nothing more specific to
 * show even if it wanted to.
 */
export default function FamilyForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await familyForgotPassword(email);
    } finally {
      setSubmitted(true);
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <FamilyAuthCard title="Check your email" success="If an account exists for that email, we've sent a link to reset your password.">
        <p className={styles.hint}>
          <a className={styles.hintLink} href="/family/login">
            Return to sign in
          </a>
        </p>
      </FamilyAuthCard>
    );
  }

  return (
    <FamilyAuthCard title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="family-forgot-password-email">
          Email
          <TextField id="family-forgot-password-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
        </label>
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? 'Sending…' : 'Send Reset Link'}
        </Button>
      </form>
      <p className={styles.hint}>
        <a className={styles.hintLink} href="/family/login">
          Return to sign in
        </a>
      </p>
    </FamilyAuthCard>
  );
}
