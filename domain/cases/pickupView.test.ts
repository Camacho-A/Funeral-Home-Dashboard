import { describe, it, expect } from 'vitest';
import { toPickupOnlyView, PICKUP_ONLY_PATCH_FIELDS } from './pickupView';
import type { Case } from '../../types/case';
import { PERMISSION_KEYS } from '../rbac/permissionCatalog';
import { DEFAULT_ROLE_DEFINITIONS } from '../rbac/defaultRoles';

const FULL_CASE: Case = {
  id: 'case-1',
  organizationId: 'org-1',
  caseNumber: 'B2026-001',
  caseType: 'cremation',
  workflowTemplateId: 'workflow-template-standard-cremation',
  workflowTemplateVersion: 1,
  workflowSnapshot: { workflowTemplateId: 'workflow-template-standard-cremation', workflowTemplateVersion: 1, stages: [], intake: { sections: [] } },
  decedentName: 'Jane Doe',
  dateOfBirth: '01/01/1950',
  dateOfDeath: '01/01/2026',
  timeOfDeath: '08:00',
  placeOfDeath: 'Test Hospital',
  weight: '150 lb',
  rawStage: 0,
  assignedStaffId: 'staff-1',
  nextOfKinName: 'John Doe',
  nextOfKinPhone: '555-0000',
  nextOfKinEmail: 'john@example.com',
  nextOfKinRelationship: 'spouse',
  nextOfKinRelationshipOther: null,
  tagNumber: 'TAG-1',
  pickupStatus: 'released',
  pickupReleasedTo: 'Funeral Home X',
  pickupReleasedAt: '2026-01-02',
  pickupNote: 'Released at noon',
  returnMethod: 'pickup',
  shippingCarrier: null,
  shippingTrackingNumber: null,
  shippingDateShipped: null,
  shippingDeliveryStatus: null,
  shippingDeliveredAt: null,
  paymentStatus: 'paid_in_full',
  isVeteran: false,
  vaStepsState: {},
  vaPublishChoice: null,
  checklistState: {},
  fieldValues: {},
  daysWaitingInStage: 0,
  isStalled: false,
  stalledReason: null,
  isDeleted: false,
  createdBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  intakeOwnerId: 'staff-1',
};

describe('toPickupOnlyView', () => {
  it('includes only id/organizationId/caseNumber/decedentName, the four pickup fields, and returnMethod', () => {
    const view = toPickupOnlyView(FULL_CASE);
    expect(view).toEqual({
      id: 'case-1',
      organizationId: 'org-1',
      caseNumber: 'B2026-001',
      decedentName: 'Jane Doe',
      pickupStatus: 'released',
      pickupReleasedTo: 'Funeral Home X',
      pickupReleasedAt: '2026-01-02',
      pickupNote: 'Released at noon',
      returnMethod: 'pickup',
    });
  });

  it('never includes NOK, financial, or any other Case field', () => {
    const view = toPickupOnlyView(FULL_CASE) as Record<string, unknown>;
    expect(view.nextOfKinName).toBeUndefined();
    expect(view.nextOfKinEmail).toBeUndefined();
    expect(view.nextOfKinRelationship).toBeUndefined();
    expect(view.paymentStatus).toBeUndefined();
    expect(view.tagNumber).toBeUndefined();
    expect(view.assignedStaffId).toBeUndefined();
    expect(view.rawStage).toBeUndefined();
  });

  it('never includes any shipping detail field', () => {
    const view = toPickupOnlyView(FULL_CASE) as Record<string, unknown>;
    expect(view.shippingCarrier).toBeUndefined();
    expect(view.shippingTrackingNumber).toBeUndefined();
    expect(view.shippingDateShipped).toBeUndefined();
    expect(view.shippingDeliveryStatus).toBeUndefined();
    expect(view.shippingDeliveredAt).toBeUndefined();
  });
});

describe('PICKUP_ONLY_PATCH_FIELDS', () => {
  it('is exactly the four pickup fields — never broadened to include returnMethod or any shipping field', () => {
    expect([...PICKUP_ONLY_PATCH_FIELDS].sort()).toEqual(['pickupNote', 'pickupReleasedAt', 'pickupReleasedTo', 'pickupStatus'].sort());
  });
});

describe('RBAC scope (conditional shipping/tracking, 2026-09) — no new permission granted to Accounting, Read Only, or Dispatch', () => {
  it('introduces no new permission key at all — the catalog has zero shipping/returnMethod-named keys', () => {
    const newKeys = (PERMISSION_KEYS as readonly string[]).filter((key) => /shipping|returnMethod|remains/i.test(key));
    expect(newKeys).toEqual([]);
  });

  it("Dispatch's permission set is unchanged — still exactly pickup.read/pickup.update plus whatever it already held", () => {
    const dispatch = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'dispatch');
    expect(dispatch).toBeDefined();
    expect(dispatch!.permissions).toContain('pickup.read');
    expect(dispatch!.permissions).toContain('pickup.update');
    expect(dispatch!.permissions).not.toContain('case.update');
    expect(dispatch!.permissions).not.toContain('case.read');
  });

  it('Accounting and Read Only hold neither pickup.* nor case.update — no shipping visibility was granted to either', () => {
    const accounting = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'accounting');
    const readOnly = DEFAULT_ROLE_DEFINITIONS.find((r) => r.key === 'readOnly');
    expect(accounting).toBeDefined();
    expect(readOnly).toBeDefined();
    for (const role of [accounting!, readOnly!]) {
      expect(role.permissions).not.toContain('pickup.update');
      expect(role.permissions).not.toContain('case.update');
    }
  });

  it('only the existing full case editors hold case.update — the gate for returnMethod/shipping writes; Accounting/Read Only/Dispatch are not among them', () => {
    const holdsCaseUpdate = DEFAULT_ROLE_DEFINITIONS.filter((r) => r.permissions.includes('case.update')).map((r) => r.key);
    expect(holdsCaseUpdate).not.toContain('accounting');
    expect(holdsCaseUpdate).not.toContain('readOnly');
    expect(holdsCaseUpdate).not.toContain('dispatch');
    expect(holdsCaseUpdate).toContain('administrator');
    expect(holdsCaseUpdate).toContain('manager');
    expect(holdsCaseUpdate).toContain('funeralDirector');
    expect(holdsCaseUpdate).toContain('officeStaff');
  });
});
