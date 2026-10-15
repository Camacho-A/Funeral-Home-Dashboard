/**
 * Organization IDs live in their own module, separate from fixtures.ts,
 * specifically so services/__mocks__/workflowTemplates.ts and fixtures.ts
 * can both depend on them without importing from each other — fixtures.ts
 * needs the standard cremation workflow template (to backfill
 * Case.workflowSnapshot on every seed case), and workflowTemplates.ts needs
 * to know which organizationId each template belongs to; either direction
 * of a direct fixtures.ts ⇄ workflowTemplates.ts import would be circular.
 */

/** The single real mock organization this frontend-only phase operates
    against — see docs/adr/ADR-002-multi-tenant-architecture.md. */
export const DEFAULT_ORGANIZATION_ID = 'managed-cremations';

/**
 * A second mock organization, used only to prove the Phase 11 workflow
 * template architecture generalizes (see
 * services/__mocks__/workflowTemplates.ts's secondOrgWorkflowTemplateFixture
 * and its accompanying tests) — there is no UI to switch the active
 * organization, so this id is never reachable through the running app;
 * OrganizationProvider (hooks/useOrganization.tsx) still always supplies
 * DEFAULT_ORGANIZATION_ID. See docs/TEMPLATE_VERSIONING.md's "Known scope
 * limits" section.
 */
export const SECOND_MOCK_ORGANIZATION_ID = 'evergreen-memorial-group';

/**
 * Gus Camacho Jr. Funeral Home (2026-10) — the second real tenant of the
 * shared Beacon backend (its own SOLIS deployment). Mock-mode only here: a
 * fictional demo roster, cases and families (see
 * services/__mocks__/gusFixtures.ts) used by the cross-tenant isolation
 * tests, and to run locally as the Gus deployment if needed
 * (docs/LOCAL_DEVELOPMENT.md). DEFAULT_ORGANIZATION_ID above stays
 * Manors' — every existing test is written against it.
 */
export const GUS_ORGANIZATION_ID = 'gus-camacho-jr';
