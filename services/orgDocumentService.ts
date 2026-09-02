import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixOrgDocumentItem, buildWixOrgDocumentData, type WixOrgDocumentItem } from '../lib/wixOrgDocumentMapper';
import type { OrgDocument, OrgDocumentStatus } from '../types/orgDocument';
import { orgDocumentFixtures } from './__mocks__/billingFixtures';

/**
 * Phase 39 (Family Billing & FTC Compliance). Sole writer of `orgDocuments` —
 * organization-level generated documents (the GPL). Append-only history: a new
 * active version supersedes the prior active one of the same type; historical
 * versions are never mutated or deleted (compliance provenance).
 */
const COLLECTION = 'orgDocuments';

export async function listOrgDocuments(organizationId: string, documentTypeKey: string, dataAdapterMode: DataAdapterMode): Promise<OrgDocument[]> {
  const all =
    dataAdapterMode === 'mock'
      ? orgDocumentFixtures.filter((d) => d.organizationId === organizationId && d.documentTypeKey === documentTypeKey)
      : (await queryWixDataItems<WixOrgDocumentItem>(COLLECTION, { filter: { organizationId, documentTypeKey } })).dataItems
          .map((i) => mapWixOrgDocumentItem(i.data))
          .filter((d): d is OrgDocument => d !== null);
  return all.sort((a, b) => b.version - a.version);
}

export async function getOrgDocument(organizationId: string, orgDocumentId: string, dataAdapterMode: DataAdapterMode): Promise<OrgDocument | null> {
  if (dataAdapterMode === 'mock') {
    return orgDocumentFixtures.find((d) => d.id === orgDocumentId && d.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrgDocumentItem>(COLLECTION, {
    filter: { organizationId, beaconOrgDocumentId: orgDocumentId },
    paging: { limit: 1 },
  });
  return mapWixOrgDocumentItem(response.dataItems[0]?.data);
}

async function nextVersion(organizationId: string, documentTypeKey: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const existing = await listOrgDocuments(organizationId, documentTypeKey, dataAdapterMode);
  return existing.length === 0 ? 1 : Math.max(...existing.map((d) => d.version)) + 1;
}

async function setStatus(organizationId: string, orgDocumentId: string, status: OrgDocumentStatus, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const idx = orgDocumentFixtures.findIndex((d) => d.id === orgDocumentId && d.organizationId === organizationId);
    if (idx !== -1) orgDocumentFixtures[idx] = { ...orgDocumentFixtures[idx], status };
    return;
  }
  const response = await queryWixDataItems<WixOrgDocumentItem>(COLLECTION, {
    filter: { organizationId, beaconOrgDocumentId: orgDocumentId },
    paging: { limit: 1 },
  });
  const row = response.dataItems[0];
  const mapped = mapWixOrgDocumentItem(row?.data);
  if (!row || !mapped) return;
  await updateWixDataItem<WixOrgDocumentItem>(COLLECTION, row.id, buildWixOrgDocumentData({ ...mapped, status }));
}

/** Persists a new active org document, superseding the prior active one of the
    same type. Returns the created row. */
export async function createOrgDocument(
  params: {
    organizationId: string;
    documentTypeKey: string;
    fileName: string;
    storageKey: string;
    checksumSha256: string;
    fileSizeBytes: number;
    effectiveDate: string;
    disclosureVersion: string;
    catalogSnapshotHash: string;
    generatedBy: string | null;
    correlationId: string;
    idFactory: () => string;
    now: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<OrgDocument> {
  const priorActive = (await listOrgDocuments(params.organizationId, params.documentTypeKey, dataAdapterMode)).find((d) => d.status === 'active');
  const version = await nextVersion(params.organizationId, params.documentTypeKey, dataAdapterMode);
  const doc: OrgDocument = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    documentTypeKey: params.documentTypeKey,
    fileName: params.fileName,
    mimeType: 'application/pdf',
    fileSizeBytes: params.fileSizeBytes,
    checksumSha256: params.checksumSha256,
    storageKey: params.storageKey,
    status: 'active',
    version,
    supersedesId: priorActive?.id ?? null,
    effectiveDate: params.effectiveDate,
    disclosureVersion: params.disclosureVersion,
    catalogSnapshotHash: params.catalogSnapshotHash,
    generatedBy: params.generatedBy,
    createdAt: params.now,
    correlationId: params.correlationId,
  };
  if (dataAdapterMode === 'mock') {
    orgDocumentFixtures.push(doc);
  } else {
    await insertWixDataItem<WixOrgDocumentItem>(COLLECTION, buildWixOrgDocumentData(doc), doc.id);
  }
  if (priorActive) await setStatus(params.organizationId, priorActive.id, 'superseded', dataAdapterMode);
  return doc;
}
