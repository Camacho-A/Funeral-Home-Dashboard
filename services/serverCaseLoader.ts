import type { DataAdapterMode } from '../lib/env';
import type { Case } from '../types/case';
import { caseFixtures } from './__mocks__/fixtures';
import { loadCaseRow } from './caseWriteService';

/**
 * Loads one case SERVER-SIDE, scoped to `organizationId` (2026-10).
 *
 * `casesService.get` is a BROWSER data accessor: in wix mode it fetches the
 * relative URL `/api/cases/{id}`, which has no origin inside a route handler
 * or webhook and throws. Every server caller wrapped it in a best-effort
 * try/catch, so the throw became a silent `null` — and the notification it
 * was loading the case for (new case, arrangement received, PDF imported,
 * payment received, document generated) was never sent. Nothing was logged
 * anywhere staff would see.
 *
 * Archived cases are returned, like the case GET route: announcing a
 * payment on an archived case is still news. Another organization's case is
 * `null`, never returned.
 */
export async function loadCaseOnServer(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
  }
  return (await loadCaseRow(organizationId, caseId))?.case_ ?? null;
}
