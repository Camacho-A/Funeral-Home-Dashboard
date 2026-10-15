import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@/domain/rbac/permissionCatalog';
import {
  GUS_ORGANIZATION_ID,
  GUS_ADMIN_IDENTITY_ID,
  GUS_DIRECTOR_IDENTITY_ID,
  GUS_VIEWER_IDENTITY_ID,
  GUS_ADMIN_EMAIL,
  GUS_DEMO_PASSWORD,
  buildGusCaseFixtures,
} from './gusFixtures';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { caseFixtures, staffFixtures, taskFixtures } from './fixtures';
import { identityFixtures, membershipFixtures } from './identityFixtures';
import { mockOrganizationFixtures } from './authFixtures';
import { organizationRoleFixtures } from './rbacFixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from './workflowTemplates';
import { parseCaseNumber } from '@/domain/cases/caseNumber';
import { listMembershipsForIdentity } from '@/services/membershipService';
import { resolvePermissions } from '@/services/permissionService';
import { findIdentityByEmail } from '@/services/identityService';
import { verifyPassword } from '@/services/passwordService';
import { getForOrganization } from '@/services/organizationsService';

const gusCases = () => caseFixtures.filter((c) => c.organizationId === GUS_ORGANIZATION_ID);

async function permissionsFor(identityId: string): Promise<Set<PermissionKey>> {
  const memberships = await listMembershipsForIdentity(identityId, 'mock');
  expect(memberships).toHaveLength(1);
  const [membership] = memberships;
  return resolvePermissions({ identityId, organizationId: membership.organizationId, roleKey: membership.role }, 'mock');
}

describe('Gus Camacho Jr. organization fixture', () => {
  it('is an active organization with case prefix M', async () => {
    const organization = await getForOrganization(GUS_ORGANIZATION_ID, 'mock');
    expect(organization).toMatchObject({ id: 'gus-camacho-jr', name: 'Gus Camacho Jr. Funeral Home', isActive: true, caseNumberPrefix: 'M' });
  });

  it("leaves Manors' fixtures intact", () => {
    expect(mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)?.name).toBe("Manor's Cremation");
    const manorsCases = caseFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID);
    expect(manorsCases.map((c) => c.caseNumber)).toEqual([
      'B2026-001', 'B2026-002', 'B2026-003', 'B2026-004', 'B2026-005', 'B2026-006', 'B2026-007', 'B2026-008',
    ]);
    expect(staffFixtures.slice(0, 3).map((s) => s.id)).toEqual(['staff-dana', 'staff-chris', 'staff-priya']);
    expect(taskFixtures.slice(0, 3).map((t) => t.id)).toEqual(['task-1', 'task-2', 'task-3']);
  });
});

describe('Gus demo cases', () => {
  it('are numbered M<current year>-001.. in order, computed from the current date', () => {
    const year = new Date().getUTCFullYear();
    const numbers = gusCases().map((c) => c.caseNumber);
    expect(numbers.length).toBeGreaterThanOrEqual(8);
    numbers.forEach((number, index) => {
      expect(number).toBe(`M${year}-${String(index + 1).padStart(3, '0')}`);
      expect(parseCaseNumber(number, 'M')).toEqual({ year, sequence: index + 1 });
    });
  });

  it('follows the clock rather than a hardcoded year', () => {
    const cases = buildGusCaseFixtures(new Date('2031-03-05T12:00:00Z'));
    expect(cases[0].caseNumber).toBe('M2031-001');
    expect(cases[0].dateOfDeath).toBe('03/05/2031');
  });

  it("run on Gus' own workflow template, spread across every stage, with some needing attention", () => {
    const template = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    expect(template.organizationId).toBe(GUS_ORGANIZATION_ID);
    for (const c of gusCases()) {
      expect(c.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);
      expect(c.workflowSnapshot?.stages.length).toBe(template.versions[0].stages.length);
    }
    const stages = new Set(gusCases().map((c) => c.rawStage));
    expect([...stages].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(gusCases().some((c) => c.isStalled)).toBe(true);
  });

  it("never references Manors' JotForm integration from Gus' template", () => {
    const template = workflowTemplateFixtures.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
    const integrationIds = template.versions.flatMap((v) => v.stages.flatMap((s) => s.checklist.items.map((i) => i.externalFormIntegrationId ?? null)));
    expect(integrationIds.every((id) => id === null)).toBe(true);
  });

  it('use only obviously fictional contact data', () => {
    for (const c of gusCases()) {
      expect(c.nextOfKinPhone).toMatch(/^\(555\) /);
      if (c.nextOfKinEmail) expect(c.nextOfKinEmail).toMatch(/@example\.test$/);
    }
  });
});

describe('Gus demo staff', () => {
  it('have memberships ONLY in Gus, and Gus has seven enabled roles', () => {
    const gusIdentityIds = [GUS_ADMIN_IDENTITY_ID, GUS_DIRECTOR_IDENTITY_ID, GUS_VIEWER_IDENTITY_ID];
    for (const identityId of gusIdentityIds) {
      const memberships = membershipFixtures.filter((m) => m.identityId === identityId);
      expect(memberships.map((m) => m.organizationId)).toEqual([GUS_ORGANIZATION_ID]);
      expect(identityFixtures.some((i) => i.id === identityId)).toBe(true);
    }
    const gusMembers = membershipFixtures.filter((m) => m.organizationId === GUS_ORGANIZATION_ID).map((m) => m.identityId);
    expect(gusMembers.sort()).toEqual([...gusIdentityIds].sort());
    expect(organizationRoleFixtures.filter((r) => r.organizationId === GUS_ORGANIZATION_ID)).toHaveLength(7);
  });

  it('the admin signs in with the documented demo password', async () => {
    const identity = await findIdentityByEmail(GUS_ADMIN_EMAIL, 'mock');
    expect(identity?.id).toBe(GUS_ADMIN_IDENTITY_ID);
    expect(await verifyPassword(GUS_ADMIN_IDENTITY_ID, GUS_DEMO_PASSWORD, 'mock')).toBe(true);
    expect(await verifyPassword(GUS_ADMIN_IDENTITY_ID, 'wrong-password', 'mock')).toBe(false);
  });

  // Every portal area the local Gus admin must reach, by the permission
  // that gates it — resolved through the real role model, never granted
  // by the fixture itself.
  const ADMIN_AREA_PERMISSIONS: Record<string, PermissionKey[]> = {
    'Dashboard / Cases / Case Details': ['case.read', 'case.create', 'case.update'],
    Documents: ['document.view', 'document.upload', 'document.generate'],
    Accounting: ['accounting.view'],
    'Staff Management': ['user.read', 'user.invite'],
    Roles: ['user.manageRoles'],
    'Document Templates': ['document.template.manage'],
    'Audit Center': ['audit.read'],
    Settings: ['organization.manage', 'settings.manage', 'workflow.publish', 'caseNumber.manage'],
    Reports: ['report.view'],
    Calendar: ['schedule.read'],
    Notifications: ['notification.read'],
  };

  it.each(Object.entries(ADMIN_AREA_PERMISSIONS))('the Gus administrator holds %s permissions via the administrator role', async (_area, keys) => {
    const permissions = await permissionsFor(GUS_ADMIN_IDENTITY_ID);
    for (const key of keys) expect(permissions.has(key), key).toBe(true);
  });

  it('the Gus read-only member can read cases but holds none of the administrative permissions', async () => {
    const permissions = await permissionsFor(GUS_VIEWER_IDENTITY_ID);
    expect(permissions.has('case.read')).toBe(true);
    for (const key of ['user.invite', 'user.manageRoles', 'organization.manage', 'settings.manage', 'document.template.manage', 'case.create', 'case.delete', 'accounting.manage'] as PermissionKey[]) {
      expect(permissions.has(key), key).toBe(false);
    }
  });
});

describe('Gus local demo — accounting', () => {
  it('seeds the starter chart of accounts for Gus only (Manors mock ledger stays empty)', async () => {
    const { ledgerAccountFixtures } = await import('./ledgerFixtures');
    const { STARTER_CHART_OF_ACCOUNTS } = await import('../../domain/ledger/starterChartOfAccounts');
    const gus = ledgerAccountFixtures.filter((a) => a.organizationId === 'gus-camacho-jr');
    expect(gus.map((a) => a.accountNumber).sort()).toEqual(STARTER_CHART_OF_ACCOUNTS.map((e) => e.accountNumber).sort());
    expect(ledgerAccountFixtures.filter((a) => a.organizationId === 'managed-cremations')).toEqual([]);
  });
});
