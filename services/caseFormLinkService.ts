import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixCaseFormLinkItem,
  buildWixCaseFormLinkData,
  applyCaseFormLinkUpdateToWixData,
  type WixCaseFormLinkItem,
} from '../lib/wixExternalFormMapper';
import type { CaseFormLink } from '../types/caseFormLink';
import { generateCaseFormLinkToken, hashCaseFormLinkToken } from '../domain/externalForms/linkToken';
import { caseFormLinkFixtures } from './__mocks__/externalFormFixtures';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Sole
 * writer of the `caseFormLinks` collection — one row per (case,
 * form-slot), deterministic id `${organizationId}-${caseId}-${formConfigId}`
 * so "get or create" is a natural-key operation, never a duplicate-row
 * risk. Only `linkTokenHash` is ever persisted — see
 * domain/externalForms/linkToken.ts's own comment.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function deterministicLinkId(organizationId: string, caseId: string, formConfigId: string): string {
  return `${organizationId}-${caseId}-${formConfigId}`;
}

export async function getById(id: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  return getByIdRaw(id, dataAdapterMode);
}

async function getByIdRaw(id: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  if (dataAdapterMode === 'mock') {
    return caseFormLinkFixtures.find((l) => l.id === id) ?? null;
  }
  const response = await queryWixDataItems<WixCaseFormLinkItem>('caseFormLinks', {
    filter: { _id: id },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  return item ? mapWixCaseFormLinkItem(item.id, item.data) : null;
}

export async function listForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink[]> {
  if (dataAdapterMode === 'mock') {
    return caseFormLinkFixtures.filter((l) => l.organizationId === organizationId && l.caseId === caseId);
  }
  const response = await queryWixDataItems<WixCaseFormLinkItem>('caseFormLinks', { filter: { organizationId, caseId } });
  return response.dataItems.map((item) => mapWixCaseFormLinkItem(item.id, item.data)).filter((l): l is CaseFormLink => l !== null);
}

async function persistUpdate(id: string, patch: Partial<CaseFormLink>, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  const withTimestamp = { ...patch, updatedAt: nowIso() };
  if (dataAdapterMode === 'mock') {
    const index = caseFormLinkFixtures.findIndex((l) => l.id === id);
    if (index === -1) return null;
    caseFormLinkFixtures[index] = { ...caseFormLinkFixtures[index], ...withTimestamp };
    return caseFormLinkFixtures[index];
  }
  const response = await queryWixDataItems<WixCaseFormLinkItem>('caseFormLinks', { filter: { _id: id }, paging: { limit: 1 } });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyCaseFormLinkUpdateToWixData(existingItem.data, withTimestamp);
  const updated = await updateWixDataItem<WixCaseFormLinkItem>('caseFormLinks', existingItem.id, merged);
  return mapWixCaseFormLinkItem(updated.id, updated.data);
}

/** Idempotent — a link for this (case, form-slot) is created once and
    reused thereafter; regenerating (see generateLinkForSending below)
    only ever overwrites its token, never creates a second row. */
async function getOrCreate(
  organizationId: string,
  caseId: string,
  provider: string,
  formConfigId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseFormLink> {
  const id = deterministicLinkId(organizationId, caseId, formConfigId);
  const existing = await getByIdRaw(id, dataAdapterMode);
  if (existing) return existing;

  const now = nowIso();
  const { linkTokenHash } = generateCaseFormLinkToken();
  const link: CaseFormLink = {
    id,
    organizationId,
    caseId,
    provider,
    formConfigId,
    linkTokenHash,
    status: 'not_sent',
    sentAt: null,
    submissionId: null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    caseFormLinkFixtures.push(link);
    return link;
  }
  const inserted = await insertWixDataItem<WixCaseFormLinkItem>('caseFormLinks', buildWixCaseFormLinkData(link), id);
  const mapped = mapWixCaseFormLinkItem(inserted.id, inserted.data);
  if (!mapped) throw new Error('Failed to create case form link.');
  return mapped;
}

/** Generates (or regenerates) this slot's raw token, marks it 'sent', and
    returns the raw token for the caller to embed in exactly one prefilled
    URL before discarding — the previous raw token (if any) is
    structurally invalidated the instant this overwrites the stored hash,
    since nothing can hash-match it anymore. */
export async function generateLinkForSending(
  organizationId: string,
  caseId: string,
  provider: string,
  formConfigId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ link: CaseFormLink; rawToken: string }> {
  const existing = await getOrCreate(organizationId, caseId, provider, formConfigId, dataAdapterMode);
  const { rawToken, linkTokenHash } = generateCaseFormLinkToken();
  const updated = await persistUpdate(
    existing.id,
    { linkTokenHash, status: 'sent', sentAt: nowIso() },
    dataAdapterMode,
  );
  if (!updated) throw new Error('Failed to update case form link.');
  return { link: updated, rawToken };
}

/** The webhook's own resolution path — hashes the incoming raw token and
    looks up by hash, never by anything client-supplied treated as
    trusted. Returns null for no match (an invalid/old/missing token),
    which the webhook route routes to the Unmatched Forms queue. */
export async function resolveByRawToken(rawToken: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  const linkTokenHash = hashCaseFormLinkToken(rawToken);
  if (dataAdapterMode === 'mock') {
    return caseFormLinkFixtures.find((l) => l.linkTokenHash === linkTokenHash) ?? null;
  }
  const response = await queryWixDataItems<WixCaseFormLinkItem>('caseFormLinks', { filter: { linkTokenHash }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  return item ? mapWixCaseFormLinkItem(item.id, item.data) : null;
}

export async function markReceived(linkId: string, submissionId: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  return persistUpdate(linkId, { status: 'received', submissionId }, dataAdapterMode);
}

export async function markReviewed(linkId: string, dataAdapterMode: DataAdapterMode): Promise<CaseFormLink | null> {
  return persistUpdate(linkId, { status: 'reviewed' }, dataAdapterMode);
}

/** Manual-linking path (Unmatched Forms) — resolves/creates the slot for
    an existing case + form config, exactly like the sent-link path, but
    without ever generating a token (the submission already exists; there
    is nothing to send). */
export async function linkExistingSubmission(
  organizationId: string,
  caseId: string,
  provider: string,
  formConfigId: string,
  submissionId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseFormLink> {
  const link = await getOrCreate(organizationId, caseId, provider, formConfigId, dataAdapterMode);
  const updated = await persistUpdate(link.id, { status: 'received', submissionId }, dataAdapterMode);
  if (!updated) throw new Error('Failed to link submission to case.');
  return updated;
}
