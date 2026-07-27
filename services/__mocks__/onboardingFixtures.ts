import type { OrganizationLocation } from '../../types/organizationLocation';
import type { OnboardingSession } from '../../types/onboarding';
import type { OrganizationBranding } from '../../types/organizationBranding';
import type { OnboardingAuditEntry } from '../../types/onboardingAudit';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Mock-mode
 * fixtures — same "in-memory arrays, mutated in place by
 * services/organizationProvisioningService.ts's mock branch" convention as
 * every other `services/__mocks__/*Fixtures.ts` file.
 *
 * Manor's Cremation's primary location and a `completed` onboarding
 * session are seeded here directly (same "seed the one real tenant's row
 * in the fixture file itself" convention `paymentIntegrationFixtures`
 * already established) — representing that Manor's own migration/backfill
 * (this phase's own "Existing Manor's Cremation Migration" requirement)
 * has already run in mock mode, consistent with mock mode never actually
 * executing a live migration script.
 */
const NOW = '2026-07-24T00:00:00.000Z';

export const MANORS_PRIMARY_LOCATION_ID = `${DEFAULT_ORGANIZATION_ID}-primary-location`;
export const MANORS_ONBOARDING_SESSION_ID = `${DEFAULT_ORGANIZATION_ID}-onboarding`;

export const organizationLocationFixtures: OrganizationLocation[] = [
  {
    id: MANORS_PRIMARY_LOCATION_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: "Manor's Cremation — Main Office",
    locationType: 'funeral_home',
    addressLine1: '100 Memorial Drive',
    addressLine2: null,
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
    phone: '(555) 201-4432',
    email: 'staff@managedcremations.test',
    isPrimary: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const onboardingSessionFixtures: OnboardingSession[] = [
  {
    id: MANORS_ONBOARDING_SESSION_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    status: 'completed',
    currentStep: 'review_launch',
    completedSteps: [
      'organization_profile',
      'primary_location',
      'administrator_account',
      'workflow_setup',
      'intake_setup',
      'services_pricing',
      'payments',
      'branding',
      'review_launch',
    ],
    startedByUserId: 'mock-user-dana',
    startedAt: NOW,
    completedAt: NOW,
    lastSavedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const organizationBrandingFixtures: OrganizationBranding[] = [
  {
    organizationId: DEFAULT_ORGANIZATION_ID,
    logoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    emailFromName: "Manor's Cremation",
    documentFooter: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const onboardingAuditFixtures: OnboardingAuditEntry[] = [];
