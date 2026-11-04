import type { DataAdapterMode } from '@/lib/env';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import { DEFAULT_JOTFORM_API_KEY_REFERENCE, isValidJotformApiKeyReference, type JotformRequestOptions } from '@/lib/jotform/jotformClient';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { listForOrganization } from '../externalFormConfigService';

/**
 * JotForm credential isolation (2026-11). Which API key reads a stored
 * submission back from JotForm — for the SSN capture, the Manatee
 * application and the Crematory Package name — resolved from the
 * authorized organization's OWN form configuration:
 *
 *   - the submission must belong to that organization;
 *   - the organization's one enabled row for that form names the key
 *     (`apiKeyReference`, an env var NAME — never the key itself);
 *   - a row without a reference (or, for Manors, no single row) reads with
 *     the original SOLIS key only when the organization's profile declares
 *     it (`jotformLegacyDefaultApiKey`: Manors, unchanged). Any other home must name its own key, and may not
 *     name the original one.
 *
 * Anything else answers null and the caller reads nothing (fails closed).
 * Only the reference NAME is ever handled here; the key never leaves
 * lib/jotform/jotformClient.ts.
 */
export async function jotformReadOptionsFor(
  organizationId: string,
  submission: Pick<ExternalFormSubmission, 'organizationId' | 'provider' | 'externalFormId'>,
  mode: DataAdapterMode,
): Promise<JotformRequestOptions | null> {
  if (submission.provider !== 'jotform' || submission.organizationId !== organizationId) return null;
  const legacy = getRegisteredOrganizationProfile(organizationId).features.jotformLegacyDefaultApiKey;
  const rows = (await listForOrganization(organizationId, mode)).filter((c) => c.provider === 'jotform' && c.externalFormId === submission.externalFormId);
  // Manors keeps reading exactly as before when its rows don't say otherwise
  // (no row, or not exactly one); every other home needs its one row.
  const named = rows.length === 1 ? rows[0].apiKeyReference?.trim() || null : null;
  if (!legacy && rows.length !== 1) return null;
  const reference = named ?? (legacy ? DEFAULT_JOTFORM_API_KEY_REFERENCE : null);
  if (!reference || !isValidJotformApiKeyReference(reference)) return null;
  if (reference === DEFAULT_JOTFORM_API_KEY_REFERENCE && !legacy) return null;
  return { apiKeyReference: reference };
}
