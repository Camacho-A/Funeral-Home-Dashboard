import type { DataAdapterMode } from '../lib/env';
import type { OrganizationMembership } from '../types/organization';
import { findOrCreateIdentity, updateIdentity } from './identityService';
import { createMembership, updateMembership } from './membershipService';

/**
 * Phase 21 (Identity, Authentication & Session Management). Migrates the
 * pre-existing `AUTH_ADAPTER='mock'|'wix'` membership model
 * (`OrganizationMembership` — `{organizationId, userId, role, isActive}`,
 * always mock-fixture-backed regardless of DATA_ADAPTER; see
 * lib/auth/authorize.ts's own comment) into the new Identity + Membership
 * model, without touching or removing anything from the old model —
 * `AUTH_ADAPTER='mock'|'wix'` sessions keep working exactly as before,
 * forever, whether or not this has ever been run.
 *
 * `legacyUsers` supplies the `(userId, email, displayName)` triples this
 * function needs but `OrganizationMembership` itself doesn't carry — for
 * mock mode that's `services/__mocks__/authFixtures.ts`'s three named
 * `AuthenticatedUser` fixtures; for a real deployment it would be whatever
 * source of truth maps a legacy userId to a real email (there has never
 * been a live Wix membership collection to read this from directly — see
 * this file's own callers). Deliberately parameterized rather than
 * importing `authFixtures.ts` directly, mirroring
 * `services/organizationProvisioningService.ts`'s `migrateExistingOrganization`,
 * which takes its own input as an explicit argument rather than reaching
 * for one specific fixture module itself.
 *
 * "No forced password resets": a migrated identity is marked
 * `emailVerified: true` and `status: 'active'` immediately (the legacy
 * model already trusted this person), but is given no password at all —
 * there was never a Beacon-owned password to carry over in the first
 * place, so there is nothing to "force reset." The very first time a
 * migrated person authenticates, they go through the ordinary
 * forgot-password flow to set their first password — establishing one,
 * not resetting one.
 *
 * "No memberships lost": every legacy membership row for a migrated user
 * is carried over, active or not (an inactive legacy row becomes a
 * `'disabled'` Membership row rather than being silently dropped — an
 * administrator can re-enable it later without re-inviting that person
 * from scratch).
 *
 * Idempotent throughout: `findOrCreateIdentity` is idempotent by email,
 * `createMembership` is idempotent by `(identityId, organizationId)` — a
 * second full run reports every user/membership as "already existing"
 * and changes nothing.
 */
export type LegacyUserRecord = {
  userId: string;
  email: string;
  displayName: string;
};

export type MigratedUserReport = {
  userId: string;
  email: string;
  identityId: string;
  isNewIdentity: boolean;
  membershipsCreated: number;
  membershipsExisting: number;
};

export type MigrationReport = {
  usersProcessed: number;
  identitiesCreated: number;
  identitiesExisting: number;
  membershipsCreated: number;
  membershipsExisting: number;
  users: MigratedUserReport[];
};

export async function migrateExistingUsers(
  legacyUsers: LegacyUserRecord[],
  legacyMemberships: OrganizationMembership[],
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    usersProcessed: 0,
    identitiesCreated: 0,
    identitiesExisting: 0,
    membershipsCreated: 0,
    membershipsExisting: 0,
    users: [],
  };

  for (const legacyUser of legacyUsers) {
    const relevantMemberships = legacyMemberships.filter((m) => m.userId === legacyUser.userId);
    if (relevantMemberships.length === 0) continue; // nothing to migrate for a user with no membership at all

    const { identity, isNew: isNewIdentity } = await findOrCreateIdentity(
      { email: legacyUser.email, displayName: legacyUser.displayName, idFactory },
      dataAdapterMode,
    );
    if (isNewIdentity) {
      await updateIdentity(identity.id, { status: 'active', emailVerified: true }, dataAdapterMode);
      report.identitiesCreated += 1;
    } else {
      report.identitiesExisting += 1;
    }

    let membershipsCreated = 0;
    let membershipsExisting = 0;
    for (const legacyMembership of relevantMemberships) {
      const { membership, isNew: isNewMembership } = await createMembership(
        {
          identityId: identity.id,
          organizationId: legacyMembership.organizationId,
          role: legacyMembership.role,
          status: 'active',
          invitedBy: null,
          idFactory,
        },
        dataAdapterMode,
      );
      if (isNewMembership && !legacyMembership.isActive) {
        await updateMembership(membership.id, { status: 'disabled' }, dataAdapterMode);
      }

      if (isNewMembership) {
        membershipsCreated += 1;
        report.membershipsCreated += 1;
      } else {
        membershipsExisting += 1;
        report.membershipsExisting += 1;
      }
    }

    report.usersProcessed += 1;
    report.users.push({
      userId: legacyUser.userId,
      email: legacyUser.email,
      identityId: identity.id,
      isNewIdentity,
      membershipsCreated,
      membershipsExisting,
    });
  }

  return report;
}
