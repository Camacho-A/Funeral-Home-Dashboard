import { describe, it, expect } from 'vitest';
import { mapWixRbacReconciliationRecordItem, buildWixRbacReconciliationRecordData } from './wixRbacReconciliationRecordMapper';
import type { RbacReconciliationRecord } from '../types/rbacReconciliationRecord';

const RECORD: RbacReconciliationRecord = {
  id: 'rec-1',
  runId: 'run-1',
  mode: 'apply',
  scopeMarker: 'PLATFORM',
  organizationId: null,
  actor: 'system:rbac-reconciliation',
  summary: {
    rolesScanned: 7,
    expectedGrants: 187,
    presentGrants: 202,
    grantsAdded: 25,
    createdAtBackfilled: 20,
    requiredChanges: 45,
    destructiveChanges: 0,
    findings: { duplicateGrants: 0, malformedGrants: 0, unknownOrStaleKeyGrants: 0, unexpectedGrants: 0, customRolesDetected: 0 },
  },
  changes: [
    {
      roleId: 'role-administrator',
      roleKey: 'administrator',
      roleScope: 'GLOBAL_DEFAULT_ROLE',
      permissionKey: 'accounting.manage',
      kind: 'grant_added',
      grantId: 'rolepermission-administrator-accounting.manage',
      priorState: 'absent',
      reason: 'expected default grant missing',
      rollback: { op: 'delete_grant', grantId: 'rolepermission-administrator-accounting.manage' },
    },
  ],
  startedAt: '2026-09-01T00:00:00.000Z',
  completedAt: '2026-09-01T00:00:01.000Z',
};

describe('wixRbacReconciliationRecordMapper', () => {
  it('round-trips a reconciliation record (JSON-encoded summary + changes)', () => {
    expect(mapWixRbacReconciliationRecordItem(buildWixRbacReconciliationRecordData(RECORD))).toEqual(RECORD);
  });

  it('preserves the PLATFORM/null-org scope marker for a global run', () => {
    const mapped = mapWixRbacReconciliationRecordItem(buildWixRbacReconciliationRecordData(RECORD));
    expect(mapped?.scopeMarker).toBe('PLATFORM');
    expect(mapped?.organizationId).toBeNull();
  });

  it('returns null for a missing id / invalid mode / invalid scope (fail closed on scalars)', () => {
    const good = buildWixRbacReconciliationRecordData(RECORD);
    expect(mapWixRbacReconciliationRecordItem({ ...good, beaconRbacReconciliationRecordId: undefined })).toBeNull();
    expect(mapWixRbacReconciliationRecordItem({ ...good, mode: 'bogus' })).toBeNull();
    expect(mapWixRbacReconciliationRecordItem({ ...good, scopeMarker: 'nope' })).toBeNull();
  });

  it('degrades unparseable JSON blobs to empty rather than dropping the whole record', () => {
    const good = buildWixRbacReconciliationRecordData(RECORD);
    const mapped = mapWixRbacReconciliationRecordItem({ ...good, summaryJson: '{not json', changesJson: 'nope' });
    expect(mapped).not.toBeNull();
    expect(mapped?.changes).toEqual([]);
    expect(mapped?.summary.grantsAdded).toBe(0);
  });
});
