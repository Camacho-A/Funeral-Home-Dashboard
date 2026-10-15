import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixExternalFormConfigItem, type WixExternalFormConfigItem } from '../lib/wixExternalFormMapper';
import { isValidJotformApiKeyReference } from '../lib/jotform/jotformClient';
import { findLayoutByMappingKey } from '../domain/externalForms/formRegistry';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import { externalFormConfigFixtures } from './__mocks__/externalFormFixtures';

/**
 * Jotform integration configuration (case-first architecture, 2026-09).
 * Read-only for this MVP — configuration rows are seeded (mock fixtures
 * today; a one-time Wix data seed in production), never created or edited
 * through the running application. There is deliberately no create/update
 * path here; any future one (or any seed script) MUST run
 * `validateExternalFormConfigs` over the full set of rows it would produce
 * and refuse to write when it reports an issue.
 *
 * MULTI-TENANT RULES (2026-10 hardening) — one Beacon backend serves
 * several organizations (Manors `managed-cremations`, Gus Camacho Jr.
 * `gus-camacho-jr`, ...):
 *   - A (provider, externalFormId) pair belongs to EXACTLY ONE
 *     organization. Each organization must use its OWN Jotform forms;
 *     Gus Camacho Jr. must never reuse a Manors form id (or any other
 *     organization's). A Jotform form id is the only routing key a webhook
 *     delivery carries, so a duplicated id would make the owning
 *     organization undecidable.
 *   - Webhook resolution (`resolveByProviderFormId`) therefore reads ALL
 *     enabled rows for the pair and FAILS CLOSED when more than one exists
 *     (or when the matching rows are otherwise invalid) — nothing is
 *     processed into any organization. There is intentionally no
 *     "first match wins" and no per-URL routing token: a URL-embedded
 *     secret was already rejected for this webhook (see
 *     lib/jotform/jotformSubmissionAuthenticity.ts), and correctness here
 *     comes from the data invariant, not from a tie-breaker.
 *   - `apiKeyReference` may name a per-organization Jotform API key env var
 *     (`JOTFORM_API_KEY_<SUFFIX>`); `mappingKey` may select a registered
 *     form layout (domain/externalForms/formRegistry.ts).
 */
export async function listForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormConfig[]> {
  if (dataAdapterMode === 'mock') {
    return externalFormConfigFixtures.filter((c) => c.organizationId === organizationId && c.isEnabled);
  }
  const response = await queryWixDataItems<WixExternalFormConfigItem>('externalFormConfigs', {
    filter: { organizationId, isEnabled: true },
  });
  return response.dataItems
    .map((item) => mapWixExternalFormConfigItem(item.id, item.data))
    .filter((c): c is ExternalFormConfig => c !== null);
}

export async function getById(organizationId: string, configId: string, dataAdapterMode: DataAdapterMode): Promise<ExternalFormConfig | null> {
  const all = await listForOrganization(organizationId, dataAdapterMode);
  return all.find((c) => c.id === configId) ?? null;
}

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

export type ExternalFormConfigIssue = {
  code:
    | 'duplicate_form_id_across_organizations'
    | 'duplicate_form_id_within_organization'
    | 'invalid_api_key_reference'
    | 'unknown_mapping_key';
  provider: string;
  externalFormId: string;
  organizationIds: string[];
  configIds: string[];
};

export type ExternalFormConfigValidation = { valid: boolean; issues: ExternalFormConfigIssue[] };

type ValidatableConfig = Pick<ExternalFormConfig, 'id' | 'organizationId' | 'provider' | 'externalFormId'> & {
  mappingKey?: string | null;
  apiKeyReference?: string | null;
};

/**
 * Pure validator for a set of external form configs — used by webhook
 * resolution below and by any future seed/create path. Reports:
 *  - the same (provider, externalFormId) configured in more than one
 *    organization (`duplicate_form_id_across_organizations`) — the
 *    cross-tenant routing hazard this hardening exists for;
 *  - the same pair configured twice in one organization
 *    (`duplicate_form_id_within_organization`) — still ambiguous: which
 *    row's link-token qid and `purpose` apply?
 *  - an `apiKeyReference` outside the `JOTFORM_API_KEY[_SUFFIX]` family;
 *  - a `mappingKey` that names no registered layout.
 * Callers decide which configs to pass (resolution passes enabled rows; a
 * seed script should pass every row, enabled or not).
 */
export function validateExternalFormConfigs(configs: readonly ValidatableConfig[]): ExternalFormConfigValidation {
  const issues: ExternalFormConfigIssue[] = [];

  const byPair = new Map<string, ValidatableConfig[]>();
  for (const config of configs) {
    const key = `${config.provider}\u0000${config.externalFormId}`;
    const group = byPair.get(key) ?? [];
    group.push(config);
    byPair.set(key, group);
  }
  for (const group of byPair.values()) {
    if (group.length < 2) continue;
    const organizationIds = [...new Set(group.map((c) => c.organizationId))].sort();
    issues.push({
      code: organizationIds.length > 1 ? 'duplicate_form_id_across_organizations' : 'duplicate_form_id_within_organization',
      provider: group[0].provider,
      externalFormId: group[0].externalFormId,
      organizationIds,
      configIds: group.map((c) => c.id).sort(),
    });
  }

  for (const config of configs) {
    const base = {
      provider: config.provider,
      externalFormId: config.externalFormId,
      organizationIds: [config.organizationId],
      configIds: [config.id],
    };
    if (config.apiKeyReference && !isValidJotformApiKeyReference(config.apiKeyReference)) {
      issues.push({ code: 'invalid_api_key_reference', ...base });
    }
    if (config.mappingKey) {
      const layout = findLayoutByMappingKey(config.mappingKey);
      if (!layout || layout.provider !== config.provider) {
        issues.push({ code: 'unknown_mapping_key', ...base });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ExternalFormConfigResolution =
  | { status: 'resolved'; config: ExternalFormConfig }
  | { status: 'not_found' }
  /** More than one enabled row claims the form, or the matching row(s)
      failed validation. Never processed into any organization. */
  | { status: 'ambiguous'; issues: ExternalFormConfigIssue[] }
  | { status: 'invalid'; issues: ExternalFormConfigIssue[] };

/** Wix page size for the resolution query — far above any legitimate
    count (which is exactly one); large enough that a duplicate is always
    seen rather than paged out. */
const RESOLUTION_QUERY_LIMIT = 100;

async function listEnabledByProviderFormId(
  provider: string,
  externalFormId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ configs: ExternalFormConfig[]; unmappableRowCount: number }> {
  if (dataAdapterMode === 'mock') {
    return {
      configs: externalFormConfigFixtures.filter((c) => c.provider === provider && c.externalFormId === externalFormId && c.isEnabled),
      unmappableRowCount: 0,
    };
  }
  const response = await queryWixDataItems<WixExternalFormConfigItem>('externalFormConfigs', {
    filter: { provider, externalFormId, isEnabled: true },
    paging: { limit: RESOLUTION_QUERY_LIMIT },
  });
  const configs: ExternalFormConfig[] = [];
  let unmappableRowCount = 0;
  for (const item of response.dataItems) {
    const mapped = mapWixExternalFormConfigItem(item.id, item.data);
    if (mapped) configs.push(mapped);
    else unmappableRowCount += 1;
  }
  return { configs, unmappableRowCount };
}

/**
 * Resolves which organization+config a webhook delivery belongs to, from
 * Solis's own stored configuration — never from the webhook payload
 * (mirrors the Clover webhook's organization-resolution principle). Reads
 * EVERY enabled row for the pair:
 *   - exactly one valid row → `resolved`;
 *   - none → `not_found` (the caller's existing unknown-form behaviour);
 *   - more than one (in one org or several), or an enabled row that does
 *     not even map (so it could be a second claimant) → `ambiguous`;
 *   - one row that fails validation → `invalid`.
 * Fails closed: only `resolved` may be processed.
 */
export async function resolveByProviderFormId(
  provider: string,
  externalFormId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ExternalFormConfigResolution> {
  const { configs, unmappableRowCount } = await listEnabledByProviderFormId(provider, externalFormId, dataAdapterMode);
  if (configs.length === 0 && unmappableRowCount === 0) return { status: 'not_found' };

  const validation = validateExternalFormConfigs(configs);
  if (configs.length + unmappableRowCount > 1) {
    return { status: 'ambiguous', issues: validation.issues };
  }
  if (configs.length === 0) {
    // A single enabled row that does not map is a broken row, not an
    // unknown form — still never processed.
    return { status: 'invalid', issues: [] };
  }
  if (!validation.valid) return { status: 'invalid', issues: validation.issues };
  return { status: 'resolved', config: configs[0] };
}

/**
 * Convenience wrapper: the resolved config, or null for ANY other outcome
 * (unknown, ambiguous or invalid) — so every existing caller fails closed
 * on a duplicated form id instead of silently taking the first match.
 */
export async function findByProviderFormId(
  provider: string,
  externalFormId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ExternalFormConfig | null> {
  const resolution = await resolveByProviderFormId(provider, externalFormId, dataAdapterMode);
  return resolution.status === 'resolved' ? resolution.config : null;
}
