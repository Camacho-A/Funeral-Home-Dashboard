import { describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { organizationRolePermissionOverrideFixtures } from './__mocks__/rbacFixtures';
import { canPerformPricingAction, pricingPermissionFor, type PricingAction } from './pricingAuthorization';
import { seedDefaultRoles } from './roleService';
import { getRegisteredOrganizationProfile } from '../domain/organization/organizationProfiles';
import { organizationRolePermissionOverrideId } from '../domain/rbac/deterministicIds';

/**
 * Price catalog (2026-11) — the approved permission model, checked through
 * the same server-side resolution every route uses (role grants plus the
 * organization's overrides). Fictional data only.
 */

const ACTIONS: PricingAction[] = ['catalog.view', 'catalog.edit', 'catalog.price', 'catalog.deactivate', 'order.customItems', 'order.reprice'];
const ROLES = ['administrator', 'manager', 'funeralDirector', 'arranger', 'officeStaff', 'accounting', 'readOnly', 'dispatch'] as const;

async function matrix(organizationId: string, options: { merchandise?: boolean } = {}) {
  const out: Record<string, Record<string, boolean>> = {};
  for (const roleKey of ROLES) {
    out[roleKey] = {};
    for (const action of ACTIONS) {
      out[roleKey][action] = await canPerformPricingAction({ identityId: `identity-fictional-${roleKey}`, organizationId, roleKey }, 'mock', action, options);
    }
  }
  return out;
}
const row = (view: boolean, edit: boolean, price: boolean, deactivate: boolean, customItems: boolean, reprice: boolean) => ({
  'catalog.view': view, 'catalog.edit': edit, 'catalog.price': price, 'catalog.deactivate': deactivate, 'order.customItems': customItems, 'order.reprice': reprice,
});

describe('Gus (granular model): catalog editing and repricing are Administrator-only', () => {
  it('server-side matrix for every default role', async () => {
    expect(await matrix(GUS_ORGANIZATION_ID)).toEqual({
      administrator: row(true, true, true, true, true, true),
      // Views the catalog and adds custom order items; nothing else.
      manager: row(true, false, false, false, true, false),
      funeralDirector: row(true, false, false, false, false, false),
      arranger: row(true, false, false, false, false, false),
      officeStaff: row(true, false, false, false, false, false),
      accounting: row(false, false, false, false, false, false),
      readOnly: row(true, false, false, false, false, false),
      dispatch: row(false, false, false, false, false, false),
    });
  });

  it('merchandise prices take the same Administrator-only price permission', async () => {
    const merchandise = await matrix(GUS_ORGANIZATION_ID, { merchandise: true });
    expect(ROLES.filter((r) => merchandise[r]['catalog.price'])).toEqual(['administrator']);
  });

  it('the Manager restriction is a standing organization override, written at onboarding and never re-imposed over an administrator\'s change', async () => {
    expect(getRegisteredOrganizationProfile(GUS_ORGANIZATION_ID).features.standingRoleOverrides).toEqual([
      expect.objectContaining({ roleKey: 'manager', permissionKey: 'serviceCatalog.edit', action: 'revoke' }),
    ]);
    const id = organizationRolePermissionOverrideId(GUS_ORGANIZATION_ID, 'manager', 'serviceCatalog.edit');
    const saved = structuredClone(organizationRolePermissionOverrideFixtures);
    try {
      // Onboarding writes it once (idempotent on re-run)…
      organizationRolePermissionOverrideFixtures.splice(0, organizationRolePermissionOverrideFixtures.length, ...saved.filter((o) => o.id !== id));
      await seedDefaultRoles(GUS_ORGANIZATION_ID, 'mock', 'onboarding');
      await seedDefaultRoles(GUS_ORGANIZATION_ID, 'mock', 'onboarding');
      expect(organizationRolePermissionOverrideFixtures.filter((o) => o.id === id)).toEqual([expect.objectContaining({ action: 'revoke' })]);
      // …and leaves an administrator's later decision alone.
      organizationRolePermissionOverrideFixtures.find((o) => o.id === id)!.action = 'grant';
      await seedDefaultRoles(GUS_ORGANIZATION_ID, 'mock', 'onboarding');
      expect(organizationRolePermissionOverrideFixtures.find((o) => o.id === id)!.action).toBe('grant');
      // An active organization's roster is never re-seeded.
      organizationRolePermissionOverrideFixtures.splice(0, organizationRolePermissionOverrideFixtures.length, ...saved.filter((o) => o.id !== id));
      const result = await seedDefaultRoles(GUS_ORGANIZATION_ID, 'mock', 'active');
      expect(result.standingOverrides).toEqual([]);
      expect(organizationRolePermissionOverrideFixtures.some((o) => o.id === id)).toBe(false);
    } finally {
      organizationRolePermissionOverrideFixtures.splice(0, organizationRolePermissionOverrideFixtures.length, ...saved);
    }
  });
});

describe('Manors (legacy model): exactly the permissions it has today', () => {
  it('maps every pricing action to the permission it already required (none to a new key)', () => {
    const map = Object.fromEntries(ACTIONS.map((a) => [a, pricingPermissionFor(DEFAULT_ORGANIZATION_ID, a)]));
    expect(map).toEqual({
      'catalog.view': 'serviceCatalog.read',
      'catalog.edit': 'serviceCatalog.edit',
      'catalog.price': 'serviceCatalog.edit',
      'catalog.deactivate': 'serviceCatalog.edit',
      'order.customItems': 'caseOrder.update',
      'order.reprice': null,
    });
    expect(pricingPermissionFor(DEFAULT_ORGANIZATION_ID, 'catalog.price', { merchandise: true })).toBe('merchandise.manage');
  });

  it('server-side matrix: Manager keeps catalog and price changes, Funeral Director and Office Staff keep custom items, nobody can reprice', async () => {
    expect(await matrix(DEFAULT_ORGANIZATION_ID)).toEqual({
      administrator: row(true, true, true, true, true, false),
      manager: row(true, true, true, true, true, false),
      funeralDirector: row(true, false, false, false, true, false),
      arranger: row(true, false, false, false, true, false),
      officeStaff: row(true, false, false, false, true, false),
      accounting: row(false, false, false, false, false, false),
      readOnly: row(true, false, false, false, false, false),
      dispatch: row(false, false, false, false, false, false),
    });
    const merchandise = await matrix(DEFAULT_ORGANIZATION_ID, { merchandise: true });
    expect(ROLES.filter((r) => merchandise[r]['catalog.price'])).toEqual(['administrator', 'manager']);
  });

  it('has no standing overrides: its live role data is not touched by this release', () => {
    expect(getRegisteredOrganizationProfile(DEFAULT_ORGANIZATION_ID).features.standingRoleOverrides).toEqual([]);
    expect(organizationRolePermissionOverrideFixtures.filter((o) => o.organizationId === DEFAULT_ORGANIZATION_ID)).toEqual([]);
  });
});
