'use server';

import { redirect } from 'next/navigation';
import { getDataAdapterMode } from '@/lib/env';
import { resetPasswordWithToken } from '@/services/passwordService';
import { revokeAllSessionsForIdentity } from '@/services/sessionService';

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const tokenParam = encodeURIComponent(token);

  if (newPassword.length < 8) {
    redirect(`/reset-password?token=${tokenParam}&error=too_short`);
  }
  if (newPassword !== confirmPassword) {
    redirect(`/reset-password?token=${tokenParam}&error=mismatch`);
  }

  const dataAdapterMode = getDataAdapterMode();
  const result = await resetPasswordWithToken(token, newPassword, dataAdapterMode);
  if (!result.success) {
    redirect(`/reset-password?token=${tokenParam}&error=invalid`);
  }

  // Explicit, immediate revocation — see app/api/auth/reset-password/route.ts's
  // own comment on why this isn't merely redundant with the password-version
  // check.
  await revokeAllSessionsForIdentity(result.identityId, dataAdapterMode);
  redirect('/login?notice=password_reset');
}
