import { describe, expect, it, vi } from 'vitest';

/**
 * Multi-tenant configuration (2026-11) — three funeral homes on one SOLIS:
 * Manors Cremation, Gus Camacho Jr. Funeral Home, and a FICTIONAL third
 * home ("Evergreen Memorial Group", unregistered — platform defaults only)
 * with its own name, prefix, services and workflow. Each must get its own
 * identity, numbering, catalog, stages, documents and permissions, and
 * nothing of another. Fictional data only; Wix is the in-memory stand-in.
 */

const wix = await vi.hoisted(async () => (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
vi.mock('@/lib/wixDataApi', () => wix.api);

const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';
const THIRD = 'evergreen-memorial-group';
const THIRD_RECORD = { id: THIRD, name: 'Evergreen Memorial Group (fictional)', legalName: 'Evergreen Memorial Group LLC (fictional)', caseNumberPrefix: 'EVG' };

const { getOrganizationProfile, getRegisteredOrganizationProfile, hasRegisteredOrganizationProfile } = await import('../domain/organization/organizationProfiles');
const { prefixForNewCaseNumber, CaseNumberPrefixNotConfiguredError } = await import('../domain/cases/caseNumber');
const { reserveNextCaseNumber } = await import('../lib/wixCaseNumberSequence');
const { getServiceCatalog } = await import('./pricingService');
const { buildWixServiceCatalogData } = await import('../lib/wixServiceCatalogMapper');
const { resolveStarterServiceCatalog } = await import('../domain/onboarding/starterServiceCatalog');
const { resolveOrganizationStages, organizationStageLabels } = await import('../domain/workflow/organizationStages');
const { standardCremationWorkflowTemplateFixture, secondOrgWorkflowTemplateFixture, buildGusServiceWorkflowTemplateFixtures } = await import('./__mocks__/workflowTemplates');
const { STAGES } = await import('../domain/cases/stages');
const { officialDocumentsFor } = await import('../domain/documents/officialDocumentTriggers');
const { resolveStatementProviderIdentity, receiptFooterFor } = await import('../domain/billing/organizationStatementOverrides');
const { pricingPermissionFor, isPriceCatalogManaged, isOrderLinePriceLocked } = await import('../domain/pricing/pricingPermissions');
const { usesTemplateStages } = await import('../domain/workflow/selectWorkflowTemplate');

const recordIdentity = (name: string) => ({ name, addressLine: `${name} street (fictional)`, phone: '(555) 000-0000' });

describe('identity and branding', () => {
  it('each home is named from its own record or profile; the third home is unregistered and gets no Manors identity', () => {
    expect(getOrganizationProfile(MANORS).displayName).toBe("Manor's Cremation");
    expect(getOrganizationProfile(GUS).displayName).toBe('Gus Camacho Jr. Funeral Home');
    const third = getOrganizationProfile(THIRD, THIRD_RECORD);
    expect(hasRegisteredOrganizationProfile(THIRD)).toBe(false);
    expect(third.displayName).toBe('Evergreen Memorial Group (fictional)');
    expect(third.legalName).toBe('Evergreen Memorial Group LLC (fictional)');
    expect(JSON.stringify(third)).not.toMatch(/Manor|Broward|Cremations America|Gus Camacho/i);
  });

  it('Statement/Receipt identity: Manors keeps its letterhead; Gus and the third home print their own records', () => {
    const manors = resolveStatementProviderIdentity(MANORS, recordIdentity('Manors record'));
    expect(JSON.stringify(manors)).toMatch(/MANORS|Broward/i);
    for (const [org, name] of [[GUS, 'Gus Camacho Jr. Funeral Home'], [THIRD, THIRD_RECORD.name]] as const) {
      const identity = resolveStatementProviderIdentity(org, recordIdentity(name));
      expect(identity.name).toBe(name);
      expect(JSON.stringify(identity)).not.toMatch(/Manor|Broward|Cremations America/i);
      expect(JSON.stringify(receiptFooterFor(org, name))).not.toMatch(/Manor|Cremations America/i);
    }
  });
});

describe('case numbering', () => {
  it('each home numbers with its own prefix from an independent sequence', async () => {
    wix.reset();
    const numbers = {
      manors: [await reserveNextCaseNumber(MANORS, 2026, prefixForNewCaseNumber(null, MANORS)), await reserveNextCaseNumber(MANORS, 2026, prefixForNewCaseNumber(null, MANORS))],
      gus: [await reserveNextCaseNumber(GUS, 2026, prefixForNewCaseNumber(null, GUS))],
      third: [await reserveNextCaseNumber(THIRD, 2026, prefixForNewCaseNumber(THIRD_RECORD, THIRD))],
    };
    expect(numbers.manors[0]).toMatch(/^B2026-\d{3}$/);
    expect(numbers.manors[1]).not.toBe(numbers.manors[0]);
    expect(numbers.gus[0]).toMatch(/^M2026-\d{3}$/);
    expect(numbers.third[0]).toMatch(/^EVG2026-\d{3}$/);
    expect(wix.rows('caseSequences').map((r) => r.id).sort()).toEqual([`${THIRD}-2026`, `${GUS}-2026`, `${MANORS}-2026`].sort());
    // Manors' two cases advanced only Manors' sequence.
    expect(Number(String(numbers.gus[0]).slice(-3))).toBe(Number(String(numbers.third[0]).slice(-3)));
  });

  it("a home with no prefix of its own is refused, never numbered like Manors", () => {
    expect(() => prefixForNewCaseNumber({ ...THIRD_RECORD, caseNumberPrefix: null }, THIRD)).toThrow(CaseNumberPrefixNotConfiguredError);
  });
});

describe('services and prices', () => {
  it('each home reads only its own catalog rows', async () => {
    wix.reset();
    const row = (org: string, id: string, displayName: string, defaultPrice: number | null) =>
      wix.seed('serviceCatalog', `wix-${id}`, buildWixServiceCatalogData({
        id, organizationId: org, serviceCode: 'BASE_SERVICE', displayName, category: 'base', pricingType: 'flat', defaultPrice,
        isActive: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }) as Record<string, unknown>);
    row(MANORS, 'svc-manors', 'Direct Cremation (fictional price)', 100_000);
    row(GUS, 'svc-gus', 'Cremation with Viewing (fictional)', null);
    row(THIRD, 'svc-third', 'Graveside Service (fictional)', 250_000);
    for (const [org, id] of [[MANORS, 'svc-manors'], [GUS, 'svc-gus'], [THIRD, 'svc-third']] as const) {
      expect((await getServiceCatalog(org, 'wix')).map((i) => i.id)).toEqual([id]);
    }
  });

  it('a new home never starts with Manors prices, and its pricing follows the platform defaults', () => {
    expect(resolveStarterServiceCatalog(THIRD).every((entry) => entry.defaultPrice === null)).toBe(true);
    expect([isPriceCatalogManaged(MANORS), isPriceCatalogManaged(GUS), isPriceCatalogManaged(THIRD)]).toEqual([false, true, true]);
    expect([isOrderLinePriceLocked(MANORS), isOrderLinePriceLocked(GUS), isOrderLinePriceLocked(THIRD)]).toEqual([false, true, true]);
    expect(pricingPermissionFor(MANORS, 'catalog.price')).toBe('serviceCatalog.edit');
    expect(pricingPermissionFor(THIRD, 'catalog.price')).toBe('serviceCatalog.price');
  });
});

describe('workflows and stages', () => {
  it('Manors keeps its fixed stage list; Gus and the third home see only their own stages', () => {
    expect(usesTemplateStages(MANORS)).toBe(false);
    expect(organizationStageLabels(resolveOrganizationStages(MANORS, [standardCremationWorkflowTemplateFixture]))).toContain(STAGES[STAGES.length - 1]);

    const gus = organizationStageLabels(resolveOrganizationStages(GUS, buildGusServiceWorkflowTemplateFixtures()));
    expect(gus).toContain('JotForm Application');

    const third = organizationStageLabels(resolveOrganizationStages(THIRD, [secondOrgWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture]));
    expect(third).toEqual(['Intake', 'Preparation', 'Service Scheduled']);
    for (const label of [...STAGES, ...gus]) if (!third.includes(label)) expect(third).not.toContain(label);
  });
});

describe('documents, integrations and roles', () => {
  it('only Manors generates its official documents; no other home inherits its templates or labels', () => {
    expect(officialDocumentsFor(MANORS)).toEqual(['envelope', 'certificate_of_cremation']);
    expect(officialDocumentsFor(GUS)).toEqual([]);
    expect(officialDocumentsFor(THIRD)).toEqual([]);
    for (const org of [GUS, THIRD]) {
      const { features } = getRegisteredOrganizationProfile(org);
      expect(features.dymoCaseLabel).toBe(false);
      expect(features.manateeDeathCertificateApplication).toBe(false);
      expect(features.arrangementPageExtracts).toBe(false);
    }
  });

  it('crematory sending: Manors configured, Gus prepared but never sending, the third home not offered', () => {
    expect(getRegisteredOrganizationProfile(MANORS).features.sendToCrematory?.emailOrganizationName).toBe('Manors Cremation');
    expect(getRegisteredOrganizationProfile(GUS).features.sendToCrematory).toMatchObject({ sendingEnabled: false });
    expect(getRegisteredOrganizationProfile(THIRD).features.sendToCrematory).toBeNull();
  });

  it('role overrides are per home: Manors none, Gus its Administrator-only catalog, the third home none', () => {
    expect(getRegisteredOrganizationProfile(MANORS).features.standingRoleOverrides).toEqual([]);
    expect(getRegisteredOrganizationProfile(GUS).features.standingRoleOverrides).toHaveLength(1);
    expect(getRegisteredOrganizationProfile(THIRD).features.standingRoleOverrides).toEqual([]);
  });
});
