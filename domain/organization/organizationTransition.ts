import { getRegisteredOrganizationProfile } from './organizationProfiles';

/**
 * Unified portal transition controls (Phase 5N, 2026-11). During the
 * Manors → Gus business transition both organizations stay operational
 * with their own case-number series. An organization can later be made
 * HISTORICAL: its cases stay accessible (and their work can be finished),
 * but no new case may be opened for it. Moving an organization to
 * historical is a separately approved change to its profile.
 */
export type OrganizationTransitionStatus = 'active' | 'historical';

export function organizationTransitionStatus(organizationId: string): OrganizationTransitionStatus {
  return getRegisteredOrganizationProfile(organizationId).features.transitionStatus;
}

export function organizationAcceptsNewCases(organizationId: string): boolean {
  return organizationTransitionStatus(organizationId) === 'active';
}

export const HISTORICAL_ORGANIZATION_MESSAGE =
  'This organization is historical: its existing cases remain available, but new cases can no longer be opened for it.';
