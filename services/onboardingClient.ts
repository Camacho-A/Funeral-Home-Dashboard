import type { Organization } from '../types/organization';
import type { OnboardingSession } from '../types/onboarding';
import type { OrganizationLocation } from '../types/organizationLocation';
import type { OrganizationMembership } from '../types/organization';
import type { WorkflowTemplate, IntakeTemplate } from '../types/workflowTemplate';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { PaymentIntegration } from '../types/payment';
import type { OrganizationBranding } from '../types/organizationBranding';
import type { LaunchChecklistItem } from '../domain/onboarding/launchReadiness';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Client-side
 * calls to /api/onboarding/* — same shape as every other `services/*`
 * client module: never branches on DATA_ADAPTER itself, always calls the
 * Route Handler. Every function other than `start` takes an
 * `onboardingSessionId`, never an `organizationId` — see
 * lib/onboarding/routeHelpers.ts's own comment on why.
 */

async function parseErrorBody(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body?.errors && Array.isArray(body.errors)) {
    return body.errors.map((e: { message: string }) => e.message).join(' ');
  }
  return body?.error ?? 'Request failed.';
}

export type StartOnboardingInput = {
  idempotencyKey: string;
  legalName: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  website?: string;
  timezone: string;
  defaultCurrency: string;
};

export async function start(input: StartOnboardingInput): Promise<{ organization: Organization; onboardingSession: OnboardingSession }> {
  const response = await fetch('/api/onboarding/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseErrorBody(response));
  return response.json();
}

export type OnboardingSessionResult = {
  onboardingSession: OnboardingSession | null;
  organization: Organization | null;
  workflowTemplate?: WorkflowTemplate | null;
  checklist: LaunchChecklistItem[];
  ready?: boolean;
};

export async function getSession(sessionId: string | null): Promise<OnboardingSessionResult> {
  const url = sessionId ? `/api/onboarding/session?sessionId=${encodeURIComponent(sessionId)}` : '/api/onboarding/session';
  const response = await fetch(url);
  if (response.status === 404) return { onboardingSession: null, organization: null, checklist: [] };
  if (!response.ok) throw new Error('Failed to load onboarding session.');
  return response.json();
}

async function patchStep<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/onboarding/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await parseErrorBody(response));
  return response.json();
}

export type OrganizationProfileInput = {
  onboardingSessionId: string;
  legalName: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  website?: string;
  timezone: string;
  defaultCurrency: string;
};
export function saveOrganizationProfile(input: OrganizationProfileInput) {
  return patchStep<{ organization: Organization; onboardingSession: OnboardingSession }>('organization', input);
}

export type PrimaryLocationInput = {
  onboardingSessionId: string;
  name: string;
  locationType?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email?: string;
};
export function savePrimaryLocation(input: PrimaryLocationInput) {
  return patchStep<{ location: OrganizationLocation; onboardingSession: OnboardingSession }>('location', input);
}

export type AdministratorInput = { onboardingSessionId: string; administratorUserId: string };
export function saveAdministrator(input: AdministratorInput) {
  return patchStep<{ membership: OrganizationMembership; onboardingSession: OnboardingSession }>('administrator', input);
}

export type WorkflowInput = { onboardingSessionId: string; mode: 'starter' | 'clone_existing' | 'minimal'; sourceTemplateId?: string; name?: string };
export function saveWorkflow(input: WorkflowInput) {
  return patchStep<{ workflowTemplate: WorkflowTemplate; onboardingSession: OnboardingSession }>('workflow', input);
}

export function saveIntake(onboardingSessionId: string) {
  return patchStep<{ intake: IntakeTemplate; onboardingSession: OnboardingSession }>('intake', { onboardingSessionId });
}

export function saveServices(onboardingSessionId: string) {
  return patchStep<{ catalog: ServiceCatalogItem[]; onboardingSession: OnboardingSession }>('services', { onboardingSessionId });
}

export type PaymentsInput = {
  onboardingSessionId: string;
  choice: 'clover' | 'not_configured' | 'configure_later';
  merchantIdReference?: string;
  credentialReference?: string;
  webhookSecretReference?: string;
};
export function savePayments(input: PaymentsInput) {
  return patchStep<{ integration: PaymentIntegration | null; readiness: string; onboardingSession: OnboardingSession }>('payments', input);
}

export type BrandingInput = {
  onboardingSessionId: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  emailFromName?: string;
  documentFooter?: string;
};
export function saveBranding(input: BrandingInput) {
  return patchStep<{ branding: OrganizationBranding; onboardingSession: OnboardingSession }>('branding', input);
}

export async function complete(onboardingSessionId: string): Promise<{ organization: Organization; onboardingSession: OnboardingSession }> {
  const response = await fetch('/api/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboardingSessionId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error ?? 'Failed to complete onboarding.') as Error & { checklist?: LaunchChecklistItem[] };
    error.checklist = body?.checklist;
    throw error;
  }
  return response.json();
}

export const onboardingClient = {
  start,
  getSession,
  saveOrganizationProfile,
  savePrimaryLocation,
  saveAdministrator,
  saveWorkflow,
  saveIntake,
  saveServices,
  savePayments,
  saveBranding,
  complete,
};
