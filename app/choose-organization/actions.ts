'use server';

import { redirect } from 'next/navigation';
import { alignSessionOrganization } from '@/lib/auth/alignSessionOrganization';

/** Unified portal (Phase 5N): the server re-checks the membership before the chosen organization becomes the working one. */
export async function chooseOrganization(formData: FormData): Promise<void> {
  const organizationId = formData.get('organizationId');
  if (typeof organizationId !== 'string') redirect('/choose-organization?error=denied');
  const result = await alignSessionOrganization(organizationId);
  if (result.status === 'unauthenticated') redirect('/login');
  if (result.status === 'mfa_enrollment_required') redirect('/mfa-setup');
  if (result.status === 'denied') redirect('/choose-organization?error=denied');
  redirect('/dashboard');
}
