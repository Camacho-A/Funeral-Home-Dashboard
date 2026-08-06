import type { DataAdapterMode } from '../../lib/env';
import { queryWixDataItems } from '../../lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '../../lib/wixCaseMapper';
import type { Case } from '../../types/case';
import { caseFixtures } from '../__mocks__/fixtures';
import { listPortalAccessForPortalUser } from './portalAccessService';
import { buildPortalCaseView, type PortalCaseView } from '../../domain/portal/portalCaseView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper — the
 * `Case` read itself mirrors `signatureService.ts`'s own private
 * `getCaseForNotification`/`portalMessagingService.ts`'s identical helper
 * (cases are read via a client-fetch service everywhere else, but a
 * server-side family route needs its own small mock/wix-branching
 * reader). Never returns a raw `Case` — always through
 * `domain/portal/portalCaseView.ts`'s allowlisting DTO.
 */
async function getCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { beaconCaseId: caseId, organizationId, isArchived: false }, paging: { limit: 1 } });
  return mapWixCaseItem(response.dataItems[0]?.data);
}

export async function getFamilyCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalCaseView | null> {
  const caseRecord = await getCase(organizationId, caseId, dataAdapterMode);
  return caseRecord ? buildPortalCaseView(caseRecord) : null;
}

/** Every case this portal user currently has *active* access to — the
    basis for `GET /api/family/cases`. Never includes a case whose grant
    is pending/disabled/revoked/expired. */
export async function listFamilyCases(portalUserId: string, dataAdapterMode: DataAdapterMode): Promise<PortalCaseView[]> {
  const access = await listPortalAccessForPortalUser(portalUserId, dataAdapterMode);
  const activeGrants = access.filter((a) => a.status === 'active');

  const cases = await Promise.all(activeGrants.map((grant) => getCase(grant.organizationId, grant.caseId, dataAdapterMode)));
  return cases.filter((c): c is Case => c !== null).map(buildPortalCaseView);
}
