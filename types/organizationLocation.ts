/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). One physical
 * (or mailing-only) location belonging to an organization — seeded during
 * onboarding's "Primary Location" step, with room for an organization to
 * add more later (no UI for that yet — out of this phase's scope, same as
 * every other "seeding only, no later-editing UI" precedent in this
 * project). Exactly one location per organization has `isPrimary: true` —
 * enforced by `services/organizationProvisioningService.ts`'s
 * `createPrimaryLocation`, never by a Wix-level constraint (Wix Data has
 * no conditional-uniqueness primitive for "unique per organizationId where
 * isPrimary=true").
 */
export type OrganizationLocationType = 'office' | 'funeral_home' | 'crematory' | 'mailing_only';

export type OrganizationLocation = {
  id: string;
  organizationId: string;
  name: string;
  locationType: OrganizationLocationType;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
