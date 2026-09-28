/**
 * Handwritten item #12 (2026-09, document Archive removal for Manors). The
 * single organization-level capability every staff-facing and server-side
 * document-archive action resolves through — never a scattered
 * `organizationId === 'managed-cremations'` check in an unrelated
 * component/route. Mirrors domain/organization/signatureRequestCapability.ts's
 * exact reasoning and shape (item #4), with one deliberate simplification:
 * there is no `Organization.documentArchivingEnabled` field (real or
 * pending) to fall back to — Archive's audit found no live customer need
 * for a persisted per-organization toggle beyond this one, disclosed,
 * organization-ID-scoped override, so this stays a plain `organizationId`
 * check rather than an Organization-record one. Because of that, this
 * single pure function serves BOTH the client (CaseDocumentsTab.tsx,
 * which already has `organizationId` synchronously via useOrganization())
 * AND the server (services/documentService.ts#archive, which already has
 * `organizationId` as a plain parameter) — no separate async
 * services/organization*CapabilityService.ts wrapper is needed here, since
 * there's no Organization fetch involved at all.
 *
 * Default polarity: document archiving is a long-established platform
 * capability every pre-existing organization already uses, so an
 * organization not named in `ORGANIZATION_OVERRIDES` defaults to `true`
 * (existing behavior preserved). Only an explicit override entry disables
 * it.
 *
 * If a real, persisted `Organization.documentArchivingEnabled` field is
 * ever added later (no Wix schema mutation is performed for this task),
 * this function's shape already accommodates it additively: accept an
 * optional second parameter carrying that field and fall back to it
 * instead of the bare `true` default — no call site needs to change,
 * exactly like signatureRequestCapability.ts's own disclosed interim
 * state.
 */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

export const ORGANIZATION_OVERRIDES: Record<string, boolean> = {
  [MANORS_ORGANIZATION_ID]: false,
};

export function isDocumentArchivingEnabled(organizationId: string | null | undefined): boolean {
  if (!organizationId) return true;
  if (organizationId in ORGANIZATION_OVERRIDES) return ORGANIZATION_OVERRIDES[organizationId];
  return true;
}
