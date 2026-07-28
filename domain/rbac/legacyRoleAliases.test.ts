import { describe, it, expect } from 'vitest';
import { LEGACY_ROLE_KEY_ALIASES, resolveRoleKeyAlias } from './legacyRoleAliases';
import { isDefaultRoleKey } from './defaultRoles';

describe('legacyRoleAliases', () => {
  it('maps every pre-existing MembershipRole/OrganizationRole value to a real default role key', () => {
    const legacyValues = ['owner', 'administrator', 'caseManager', 'staff', 'readOnly'];
    for (const value of legacyValues) {
      expect(LEGACY_ROLE_KEY_ALIASES[value]).toBeDefined();
      expect(isDefaultRoleKey(LEGACY_ROLE_KEY_ALIASES[value])).toBe(true);
    }
  });

  it('owner and administrator both alias to the administrator default role (preserves admin-tier behavior)', () => {
    expect(resolveRoleKeyAlias('owner')).toBe('administrator');
    expect(resolveRoleKeyAlias('administrator')).toBe('administrator');
  });

  it('caseManager aliases to funeralDirector, staff aliases to officeStaff', () => {
    expect(resolveRoleKeyAlias('caseManager')).toBe('funeralDirector');
    expect(resolveRoleKeyAlias('staff')).toBe('officeStaff');
  });

  it('readOnly aliases to itself', () => {
    expect(resolveRoleKeyAlias('readOnly')).toBe('readOnly');
  });

  it('passes through an unrecognized key unchanged (e.g. a Phase 22 default key or a custom role key)', () => {
    expect(resolveRoleKeyAlias('manager')).toBe('manager');
    expect(resolveRoleKeyAlias('custom_abc123')).toBe('custom_abc123');
  });
});
