import { NextResponse } from 'next/server';
import type { DataAdapterMode } from '../env';
import { isModuleHidden, type HideableModuleKey } from '../../domain/organization/moduleVisibility';
import { getRegisteredOrganizationProfile } from '../../domain/organization/organizationProfiles';
import { getForOrganization } from '../../services/organizationsService';

/**
 * Server-side enforcement of per-organization hidden modules (Gus, 2026-10).
 * `hiddenModules` used to be navigation-only for Accounting; an organization
 * that hides Chart of Accounts / Journal Entries / Banking (Gus Camacho Jr.)
 * must not be able to reach those features by direct URL or API either.
 *
 * Opt-in per organization (`features.enforceHiddenModulesServerSide`):
 * organizations without it (Manors) keep the historical nav-only behaviour.
 *
 * Call AFTER `requireAuthorizedOrganization` — the organization id must
 * already be the caller's authorized one. Answers 404 (the feature does not
 * exist for this organization), matching how hidden reports are answered.
 * Nothing is deleted: the underlying records stay intact and every other
 * organization is unaffected.
 */
export async function isModuleHiddenForOrganization(
  organizationId: string,
  key: HideableModuleKey,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  if (!getRegisteredOrganizationProfile(organizationId).features.enforceHiddenModulesServerSide)
    return false;
  const organization = await getForOrganization(organizationId, dataAdapterMode);
  return isModuleHidden(
    { id: organizationId, hiddenModules: organization?.hiddenModules ?? null },
    key,
  );
}

export async function rejectIfModuleHidden(
  organizationId: string,
  key: HideableModuleKey,
  dataAdapterMode: DataAdapterMode,
): Promise<NextResponse | null> {
  if (!(await isModuleHiddenForOrganization(organizationId, key, dataAdapterMode))) return null;
  return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}
