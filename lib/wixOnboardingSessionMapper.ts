import type { OnboardingSession, OnboardingStatus, OnboardingStepKey } from '../types/onboarding';

const VALID_STATUSES: OnboardingStatus[] = ['not_started', 'in_progress', 'blocked', 'completed'];
const VALID_STEPS: OnboardingStepKey[] = [
  'organization_profile',
  'primary_location',
  'administrator_account',
  'workflow_setup',
  'intake_setup',
  'services_pricing',
  'payments',
  'branding',
  'review_launch',
];

function isValidStatus(value: unknown): value is OnboardingStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

function isValidStep(value: unknown): value is OnboardingStepKey {
  return typeof value === 'string' && (VALID_STEPS as string[]).includes(value);
}

function isValidStepArray(value: unknown): value is OnboardingStepKey[] {
  return Array.isArray(value) && value.every(isValidStep);
}

export type WixOnboardingSessionItem = {
  beaconOnboardingSessionId?: unknown;
  organizationId?: unknown;
  status?: unknown;
  currentStep?: unknown;
  completedSteps?: unknown;
  startedByUserId?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  lastSavedAt?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixOnboardingSessionItem(item: WixOnboardingSessionItem | undefined): OnboardingSession | null {
  if (
    !item ||
    typeof item.beaconOnboardingSessionId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    !isValidStatus(item.status) ||
    !isValidStep(item.currentStep) ||
    !isValidStepArray(item.completedSteps) ||
    typeof item.startedByUserId !== 'string' ||
    typeof item.startedAt !== 'string' ||
    typeof item.lastSavedAt !== 'string' ||
    typeof item.version !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconOnboardingSessionId,
    organizationId: item.organizationId,
    status: item.status,
    currentStep: item.currentStep,
    completedSteps: item.completedSteps,
    startedByUserId: item.startedByUserId,
    startedAt: item.startedAt,
    completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
    lastSavedAt: item.lastSavedAt,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixOnboardingSessionData(session: OnboardingSession): WixOnboardingSessionItem {
  return {
    beaconOnboardingSessionId: session.id,
    organizationId: session.organizationId,
    status: session.status,
    currentStep: session.currentStep,
    completedSteps: session.completedSteps,
    startedByUserId: session.startedByUserId,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    lastSavedAt: session.lastSavedAt,
    version: session.version,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Merges a partial patch onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    in this codebase. */
export function applyOnboardingSessionUpdateToWixData(
  existing: WixOnboardingSessionItem,
  patch: Partial<OnboardingSession>,
): WixOnboardingSessionItem {
  const next: WixOnboardingSessionItem = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.currentStep !== undefined) next.currentStep = patch.currentStep;
  if (patch.completedSteps !== undefined) next.completedSteps = patch.completedSteps;
  if (patch.completedAt !== undefined) next.completedAt = patch.completedAt;
  if (patch.lastSavedAt !== undefined) next.lastSavedAt = patch.lastSavedAt;
  if (patch.version !== undefined) next.version = patch.version;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
