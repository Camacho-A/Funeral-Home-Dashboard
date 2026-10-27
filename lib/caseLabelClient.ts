import type { ManorsLabelField, ManorsLabelValues } from '@/domain/labels/manorsLabel';
import type { CaseDocumentStatus } from '@/types/caseDocument';

/**
 * Cremation Label (2026-10). Client wrappers for app/api/cases/[caseId]/label.
 * Every error throws with the server's own message.
 */
export type SavedCremationLabel = {
  documentId: string;
  version: number | null;
  status: CaseDocumentStatus;
  createdAt: string;
  actorDisplayName: string | null;
};

export type CremationLabelState = {
  current:
    | { ok: true; values: ManorsLabelValues; labelXml: string }
    | { ok: false; missing: ManorsLabelField[]; message: string };
  latest: (SavedCremationLabel & { values: ManorsLabelValues | null }) | null;
  latestMatchesCase: boolean;
};

export type SavedCremationLabelFile = {
  label: SavedCremationLabel;
  labelXml: string;
  values: ManorsLabelValues | null;
  isLatest: boolean;
};

async function parseOrThrow<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : fallback);
  return body as T;
}

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/label`;

export async function fetchCremationLabelState(organizationId: string, caseId: string): Promise<CremationLabelState> {
  const response = await fetch(`${base(caseId)}?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' });
  return parseOrThrow(response, 'The label could not be loaded. Please try again.');
}

export async function saveCremationLabel(
  organizationId: string,
  caseId: string,
  expectedLatestDocumentId: string | null,
): Promise<{ outcome: 'saved' | 'unchanged'; documentId: string; version: number | null }> {
  const response = await fetch(base(caseId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, expectedLatestDocumentId }),
  });
  return parseOrThrow(response, 'The label could not be saved. Please try again.');
}

export async function fetchSavedCremationLabel(organizationId: string, caseId: string, documentId: string): Promise<SavedCremationLabelFile> {
  const response = await fetch(`${base(caseId)}/saved/${encodeURIComponent(documentId)}?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' });
  return parseOrThrow(response, 'The saved label could not be loaded. Please try again.');
}

export async function recordCremationLabelPrinted(organizationId: string, caseId: string, documentId: string, printerName: string): Promise<void> {
  const response = await fetch(`${base(caseId)}/saved/${encodeURIComponent(documentId)}/printed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, printerName }),
  });
  await parseOrThrow(response, 'The print could not be recorded.');
}
