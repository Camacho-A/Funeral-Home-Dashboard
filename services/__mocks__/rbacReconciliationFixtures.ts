import type { RbacReconciliationRecord } from '../../types/rbacReconciliationRecord';

/**
 * Phase 38 (RBAC Grant Hygiene). Mock-mode store for the
 * `rbacReconciliationRecords` collection — empty by default (no run has
 * occurred), matching the "collection exists, no rows yet" live baseline.
 * Tests push/inspect records here exactly as `rbacFixtures.ts` does for the
 * other RBAC collections.
 */
export const rbacReconciliationRecordFixtures: RbacReconciliationRecord[] = [];
