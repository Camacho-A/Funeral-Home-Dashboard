import type { DataAdapterMode } from '../lib/env';
import { findIdentityByEmail } from './identityService';
import { getMembership } from './membershipService';
import { getById, create } from './staffProfileService';
import type { StaffRole } from '../types/staffProfile';

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * Backfills a real, Identity-backed `StaffProfile` row for each of an
 * organization's pre-existing mock-only `StaffProfile.id` values (e.g.
 * `'staff-dana'`) — fully additive, zero FK-value rewrites: `Case`/
 * `CaseTask` rows referencing these ids are never touched, because there
 * has never been a live `staffProfiles` collection to reconcile against.
 *
 * **Two-phase, dry-run-then-apply** (`options.apply`): a dry run only
 * *resolves* — it looks up a real `Identity` by the fixture's known email
 * correspondence (the same emails Phase 21's own identity migration
 * already used for this tenant) and reports per-row whether that
 * resolved, **never inventing an `Identity`** for a row that doesn't
 * resolve. Only `options.apply: true` writes anything, and only after the
 * dry-run report has been reviewed.
 *
 * **Idempotent**: keyed by the deterministic `legacyStaffProfileId` — a
 * row that already exists is reported as `'already-existing'` and left
 * untouched; re-running `apply` a second time is a no-op.
 *
 * **Never a runtime email match**: this bootstrap-only correspondence is
 * the one, explicitly-named exception to "identity is never inferred by
 * email" — every other lookup in this codebase resolves by explicit id.
 */
export type LegacyStaffProfileRecord = {
  legacyStaffProfileId: string;
  organizationId: string;
  displayName: string;
  role: StaffRole;
  /** The known email correspondence for this legacy fixture row — a
      one-time bootstrap input, never read again after this migration. */
  email: string;
};

export type StaffProfileMigrationRowReport = {
  legacyStaffProfileId: string;
  email: string;
  status: 'already-existing' | 'resolved' | 'unresolved' | 'created';
  resolvedIdentityId: string | null;
  resolvedMembershipId: string | null;
};

export type StaffProfileMigrationReport = {
  apply: boolean;
  rowsProcessed: number;
  resolved: number;
  unresolved: number;
  created: number;
  alreadyExisting: number;
  rows: StaffProfileMigrationRowReport[];
};

export async function migrateStaffProfiles(
  legacyRecords: readonly LegacyStaffProfileRecord[],
  options: { apply: boolean; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<StaffProfileMigrationReport> {
  const report: StaffProfileMigrationReport = {
    apply: options.apply,
    rowsProcessed: 0,
    resolved: 0,
    unresolved: 0,
    created: 0,
    alreadyExisting: 0,
    rows: [],
  };

  for (const record of legacyRecords) {
    report.rowsProcessed += 1;

    const existing = await getById(record.organizationId, record.legacyStaffProfileId, dataAdapterMode);
    if (existing) {
      report.alreadyExisting += 1;
      report.rows.push({
        legacyStaffProfileId: record.legacyStaffProfileId,
        email: record.email,
        status: 'already-existing',
        resolvedIdentityId: existing.identityId,
        resolvedMembershipId: existing.membershipId,
      });
      continue;
    }

    const identity = await findIdentityByEmail(record.email, dataAdapterMode);
    if (!identity) {
      report.unresolved += 1;
      report.rows.push({
        legacyStaffProfileId: record.legacyStaffProfileId,
        email: record.email,
        status: 'unresolved',
        resolvedIdentityId: null,
        resolvedMembershipId: null,
      });
      continue;
    }

    const membership = await getMembership(identity.id, record.organizationId, dataAdapterMode);
    report.resolved += 1;

    if (!options.apply) {
      report.rows.push({
        legacyStaffProfileId: record.legacyStaffProfileId,
        email: record.email,
        status: 'resolved',
        resolvedIdentityId: identity.id,
        resolvedMembershipId: membership?.id ?? null,
      });
      continue;
    }

    await create(
      record.organizationId,
      {
        identityId: identity.id,
        membershipId: membership?.id ?? null,
        displayName: record.displayName,
        role: record.role,
        idFactory: () => record.legacyStaffProfileId,
        now: options.now,
      },
      dataAdapterMode,
    );
    report.created += 1;
    report.rows.push({
      legacyStaffProfileId: record.legacyStaffProfileId,
      email: record.email,
      status: 'created',
      resolvedIdentityId: identity.id,
      resolvedMembershipId: membership?.id ?? null,
    });
  }

  return report;
}
