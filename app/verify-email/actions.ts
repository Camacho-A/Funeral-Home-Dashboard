'use server';

import { redirect } from 'next/navigation';
import { getDataAdapterMode } from '@/lib/env';
import { verifyEmailWithToken } from '@/services/emailVerificationService';

export async function verifyEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const tokenParam = encodeURIComponent(token);

  const result = await verifyEmailWithToken(token, getDataAdapterMode());
  if (!result.success) {
    redirect(`/verify-email?token=${tokenParam}&error=1`);
  }

  redirect('/verify-email?verified=1');
}
