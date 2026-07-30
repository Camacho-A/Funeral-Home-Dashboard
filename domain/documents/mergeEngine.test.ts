import { describe, expect, it } from 'vitest';
import type { Case } from '@/types/case';
import type { CaseOrder } from '@/types/caseOrder';
import type { Organization } from '@/types/organization';
import type { OrganizationBranding } from '@/types/organizationBranding';
import type { OrganizationLocation } from '@/types/organizationLocation';
import {
  MERGE_FIELD_CATALOG,
  RESERVED_FIELD_PLACEHOLDER,
  mergeTemplate,
  resolveMergeContext,
  validateMergeTokens,
  type MergeSourceData,
} from './mergeEngine';

const NOW = '2026-07-20T00:00:00.000Z';

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-1',
    organizationId: 'org-1',
    caseNumber: 'B2026-014',
    decedentName: 'Robert Ellison',
    dateOfBirth: '04/12/1951',
    dateOfDeath: '01/02/2026',
    timeOfDeath: '',
    placeOfDeath: '',
    weight: '178 lb',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: 'Margaret Ellison',
    nextOfKinPhone: '(555) 010-1234',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: null,
    intakeOwnerId: null,
    createdAt: NOW,
    isDeleted: false,
    workflowTemplateId: 'wf-1',
    workflowTemplateVersion: 1,
    caseType: 'cremation',
    workflowSnapshot: null,
    ...overrides,
  };
}

function makeCaseOrder(overrides: Partial<CaseOrder> = {}): CaseOrder {
  return {
    id: 'order-1',
    organizationId: 'org-1',
    caseId: 'case-1',
    status: 'active',
    subtotal: 89_000,
    discountTotal: 0,
    taxTotal: 0,
    total: 89_000,
    balanceDue: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: "Manor's Cremation",
    isActive: true,
    primaryPhone: '(555) 555-0100',
    primaryEmail: 'office@manorscremation.com',
    defaultCurrency: 'usd',
    ...overrides,
  };
}

function makeBranding(overrides: Partial<OrganizationBranding> = {}): OrganizationBranding {
  return {
    organizationId: 'org-1',
    logoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    emailFromName: null,
    documentFooter: 'Licensed Funeral Establishment No. 12345',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeLocation(overrides: Partial<OrganizationLocation> = {}): OrganizationLocation {
  return {
    id: 'loc-1',
    organizationId: 'org-1',
    name: 'Main Office',
    locationType: 'office',
    addressLine1: '123 Main St',
    addressLine2: null,
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
    phone: '(555) 555-0100',
    email: null,
    isPrimary: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSource(overrides: Partial<MergeSourceData> = {}): MergeSourceData {
  return {
    case: makeCase(),
    caseOrder: makeCaseOrder(),
    organization: makeOrganization(),
    branding: makeBranding(),
    location: makeLocation(),
    ...overrides,
  };
}

describe('MERGE_FIELD_CATALOG', () => {
  it('every entry\'s identifier matches its own catalog key', () => {
    for (const [key, definition] of Object.entries(MERGE_FIELD_CATALOG)) {
      expect(definition.identifier).toBe(key);
    }
  });

  it('reserved fields (case.service.date/location) are marked wired: false and always resolve null', () => {
    expect(MERGE_FIELD_CATALOG['case.service.date'].wired).toBe(false);
    expect(MERGE_FIELD_CATALOG['case.service.date'].resolve(makeSource())).toBeNull();
    expect(MERGE_FIELD_CATALOG['case.service.location'].wired).toBe(false);
    expect(MERGE_FIELD_CATALOG['case.service.location'].resolve(makeSource())).toBeNull();
  });

  it('every non-reserved field resolves to a real value against representative source data', () => {
    const source = makeSource();
    for (const [key, definition] of Object.entries(MERGE_FIELD_CATALOG)) {
      if (!definition.wired) continue;
      expect(definition.resolve(source), `expected ${key} to resolve`).not.toBeNull();
    }
  });
});

describe('validateMergeTokens', () => {
  it('accepts a body with only recognized tokens (wired and reserved)', () => {
    const result = validateMergeTokens('Dear {{case.primaryContact.fullName}}, regarding {{case.decedent.fullName}} on {{case.service.date}}.');
    expect(result.valid).toBe(true);
    expect(result.unknownTokens).toEqual([]);
  });

  it('rejects a body with an unrecognized token, naming it exactly', () => {
    const result = validateMergeTokens('Total due: {{financial.totalAmount}}');
    expect(result.valid).toBe(false);
    expect(result.unknownTokens).toEqual(['financial.totalAmount']);
  });

  it('names every distinct unrecognized token, deduplicated', () => {
    const result = validateMergeTokens('{{bogus.one}} and {{bogus.two}} and {{bogus.one}} again');
    expect(result.unknownTokens.sort()).toEqual(['bogus.one', 'bogus.two']);
  });
});

describe('resolveMergeContext', () => {
  it('resolves every catalog key, including reserved ones', () => {
    const resolved = resolveMergeContext(makeSource());
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(MERGE_FIELD_CATALOG).sort());
  });

  it('reserved fields resolve to the visible placeholder, never an empty string', () => {
    const resolved = resolveMergeContext(makeSource());
    expect(resolved['case.service.date']).toBe(RESERVED_FIELD_PLACEHOLDER);
    expect(resolved['case.service.location']).toBe(RESERVED_FIELD_PLACEHOLDER);
  });

  it('a wired field with no per-instance data (no CaseOrder) also resolves to the placeholder, never blank', () => {
    const resolved = resolveMergeContext(makeSource({ caseOrder: null }));
    expect(resolved['financial.total']).toBe(RESERVED_FIELD_PLACEHOLDER);
    expect(resolved['financial.balanceDue']).toBe(RESERVED_FIELD_PLACEHOLDER);
  });

  it('formats currency fields using the organization\'s currency', () => {
    const resolved = resolveMergeContext(makeSource());
    expect(resolved['financial.total']).toBe('$890.00');
  });
});

describe('mergeTemplate', () => {
  it('substitutes every recognized token with its resolved value', () => {
    const resolved = resolveMergeContext(makeSource());
    const merged = mergeTemplate('Dear {{case.primaryContact.fullName}}, this concerns {{case.decedent.fullName}}.', resolved);
    expect(merged).toBe('Dear Margaret Ellison, this concerns Robert Ellison.');
  });

  it('substitutes a reserved token with the visible placeholder, never a blank', () => {
    const resolved = resolveMergeContext(makeSource());
    const merged = mergeTemplate('Service date: {{case.service.date}}', resolved);
    expect(merged).toBe(`Service date: ${RESERVED_FIELD_PLACEHOLDER}`);
    expect(merged).not.toContain('Service date: \n');
    expect(merged).not.toMatch(/Service date:\s*$/);
  });

  it('throws — never silently blanks — when a token is not present in the resolved map at all', () => {
    expect(() => mergeTemplate('{{totally.unknown.field}}', {})).toThrow(/totally\.unknown\.field/);
  });

  it('throws naming every unrecognized token when multiple appear', () => {
    expect(() => mergeTemplate('{{a.b}} and {{c.d}}', {})).toThrow(/a\.b.*c\.d|c\.d.*a\.b/);
  });
});
