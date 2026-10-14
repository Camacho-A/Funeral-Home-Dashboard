import type { OrganizationLocation } from '../../types/organizationLocation';
import type { OnboardingSession } from '../../types/onboarding';
import type { OrganizationBranding } from '../../types/organizationBranding';
import type { OnboardingAuditEntry } from '../../types/onboardingAudit';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './organizationIds';

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
    // A stand-in logo, deliberately not any real funeral home's artwork
    // (2026-10). This used to point at public/brand/manors-logo.png — a
    // live customer's own file, which meant one organization's artwork
    // shipped inside every build and was publicly served from every
    // deployment, purely to give mock mode something to render.
    //
    // An inline SVG data URI instead: `logoUrl` is a plain URL string by
    // design (see types/organizationBranding.ts — "no field capable of
    // holding binary/base64 image data"), a data URI satisfies that and
    // needs no asset at all, and Sidebar.tsx's `useOrganizationBranding()`
    // renders it exactly like any uploaded logo. Real organizations are
    // unaffected: their logos live in their own branding rows, uploaded
    // through Settings.
    logoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%231f3a5f'/><path d='M20 42V26l12-8 12 8v16H36v-10h-8v10z' fill='%23ffffff'/></svg>",
    signInLogoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    emailFromName: "Manor's Cremation",
    documentFooter: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    // A SECOND organization with its OWN logo (2026-10). Multi-tenant
    // branding is only really demonstrated by two tenants that differ, so
    // dev and tests can both show that the login card and sidebar follow
    // the organization rather than a hardcoded asset.
    //
    // An inline SVG rather than a file: no real funeral home's artwork
    // belongs in the product repo as sample data, and a data URI needs no
    // asset at all.
    organizationId: SECOND_MOCK_ORGANIZATION_ID,
    logoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='28' fill='%23166534'/><path d='M32 14c8 10 8 26 0 36-8-10-8-26 0-36z' fill='%23ffffff'/></svg>",
    signInLogoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    emailFromName: 'Evergreen Memorial Group',
    documentFooter: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const onboardingAuditFixtures: OnboardingAuditEntry[] = [];
