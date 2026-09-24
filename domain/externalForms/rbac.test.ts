import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@/domain/rbac/permissionCatalog';
import { DEFAULT_ROLE_DEFINITIONS } from '@/domain/rbac/defaultRoles';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). This
 * integration introduces ZERO new permission keys — every route reuses
 * the existing `case.read` (view) and `case.update` (generate/regenerate
 * links, review/reconcile, manual-link) permissions. This test asserts
 * that structurally, rather than trusting each route's own call site.
 */
describe('Jotform integration introduces no new permission keys', () => {
  it('the permission catalog has no external_form.*/intake.*/jotform.*-named key', () => {
    const newLookingKeys = (PERMISSION_KEYS as readonly string[]).filter((key) => /external_form|intake\.|jotform/i.test(key));
    expect(newLookingKeys).toEqual([]);
  });

  it('Dispatch, Accounting, and Read Only are not broadened — none gain case.update from this work', () => {
    const dispatch = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'dispatch')!;
    const accounting = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'accounting')!;
    const readOnly = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'readOnly')!;

    for (const role of [dispatch, accounting, readOnly]) {
      expect(role.permissions).not.toContain('case.update');
    }
  });

  it('Read Only retains case.read (can view Forms/submissions) but not case.update (cannot generate links/reconcile/link)', () => {
    const readOnly = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'readOnly')!;
    expect(readOnly.permissions).toContain('case.read');
    expect(readOnly.permissions).not.toContain('case.update');
  });

  it('the existing full case editors (administrator/manager/funeralDirector/arranger/officeStaff) hold case.update — the gate this integration\'s write routes reuse', () => {
    const holdsCaseUpdate = DEFAULT_ROLE_DEFINITIONS.filter((r) => r.permissions.includes('case.update')).map((r) => r.key);
    for (const expected of ['administrator', 'manager', 'funeralDirector', 'arranger', 'officeStaff']) {
      expect(holdsCaseUpdate).toContain(expected);
    }
  });
});
