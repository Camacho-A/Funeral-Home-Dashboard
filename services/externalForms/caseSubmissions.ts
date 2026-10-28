import type { DataAdapterMode } from '@/lib/env';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import { listForCase as listCaseFormLinks } from '../caseFormLinkService';
import { getById as getSubmissionById } from '../externalFormSubmissionService';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixExternalFormSubmissionItem, type WixExternalFormSubmissionItem } from '@/lib/wixExternalFormMapper';

/**
 * Every intake-form submission belonging to a case, newest first — the
 * ones linked to it and the one it was created from. Only this
 * organization's submissions are ever returned. Shared by Send to Crematory
 * (the package name) and the Manatee County application (2026-10).
 */
export async function listCaseSubmissionsNewestFirst(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<ExternalFormSubmission[]> {
  const linked = (await listCaseFormLinks(organizationId, caseId, mode)).map((link) => link.submissionId).filter((id): id is string => Boolean(id));
  const submissions = (await Promise.all(linked.map((id) => getSubmissionById(id, mode)))).filter(
    (s): s is ExternalFormSubmission => s !== null && s.organizationId === organizationId,
  );
  if (mode === 'mock') {
    const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
    submissions.push(...externalFormSubmissionFixtures.filter((s) => s.organizationId === organizationId && s.createdCaseId === caseId));
  } else {
    const created = await queryWixDataItems<WixExternalFormSubmissionItem>('externalFormSubmissions', {
      filter: { organizationId, createdCaseId: caseId },
      paging: { limit: 20 },
    });
    for (const item of created.dataItems) {
      const mapped = mapWixExternalFormSubmissionItem(item.id, item.data);
      if (mapped) submissions.push(mapped);
    }
  }
  return [...new Map(submissions.map((s) => [s.id, s])).values()].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}
