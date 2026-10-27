import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { caseDocumentFixtures } from '@/services/__mocks__/documentFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Case } from '@/types/case';

/**
 * Cremation Label (2026-10). The real routes, label service and document
 * pipeline in mock mode; storage in memory; fictional values only. Two
 * different staff sessions take turns to show a saved label is shared.
 */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Buffer>() }));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer) => (blobs.set(key, Buffer.from(contents)), { storageKey: key }),
    downloadFile: async (key: string) => ({ buffer: blobs.get(key)!, contentType: 'application/vnd.dymo.label+xml' }),
    deleteFile: async () => undefined,
  },
}));

let session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'staff-dana', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) => {
    if (requested !== session.organizationId) {
      return { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) };
    }
    return { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } };
  }),
}));
const { canReadCases, canGenerateDocument } = vi.hoisted(() => ({ canReadCases: vi.fn(async () => true), canGenerateDocument: vi.fn(async () => true) }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return { ...actual, canReadCases, canGenerateDocument };
});

const labelRoute = await import('./route');
const savedRoute = await import('./saved/[documentId]/route');
const printedRoute = await import('./saved/[documentId]/printed/route');

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
let lengths = { documents: 0, activity: 0 };
beforeEach(() => {
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length };
  caseFixtures[index] = { ...original, decedentName: 'JUNIPER FAIRWEATHER', decedentMiddleName: null, tagNumber: '90210', dateOfCremation: '11/03/2026' };
});
afterEach(() => {
  caseFixtures[index] = original;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  blobs.clear();
  session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'staff-dana', role: 'administrator' };
  vi.clearAllMocks();
});

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const getState = (organizationId = session.organizationId) =>
  labelRoute.GET(new Request(`http://localhost/api/cases/${CASE_ID}/label?organizationId=${organizationId}`), { params: Promise.resolve({ caseId: CASE_ID }) });
const save = (expectedLatestDocumentId: string | null, headers: Record<string, string> = SAME_ORIGIN) =>
  labelRoute.POST(new Request(`http://localhost/api/cases/${CASE_ID}/label`, { method: 'POST', headers, body: JSON.stringify({ organizationId: session.organizationId, expectedLatestDocumentId }) }), {
    params: Promise.resolve({ caseId: CASE_ID }),
  });
const getSaved = (documentId: string) =>
  savedRoute.GET(new Request(`http://localhost/api/cases/${CASE_ID}/label/saved/${documentId}?organizationId=${session.organizationId}`), { params: Promise.resolve({ caseId: CASE_ID, documentId }) });
const printed = (documentId: string, printerName = 'DYMO LabelWriter 550') =>
  printedRoute.POST(
    new Request(`http://localhost/api/cases/${CASE_ID}/label/saved/${documentId}/printed`, { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ organizationId: session.organizationId, printerName }) }),
    { params: Promise.resolve({ caseId: CASE_ID, documentId }) },
  );

describe('Cremation Label routes', () => {
  it('saves a label, and another staff member\'s session reads the same saved file and prints it', async () => {
    const before = await (await getState()).json();
    expect(before).toMatchObject({ latest: null, latestMatchesCase: false, current: { ok: true, values: { name: 'Juniper Fairweather', tag: 'Tag #90210', date: 'November 3, 2026' } } });

    const saved = await save(null);
    expect(saved.status).toBe(201);
    const { documentId, version } = await saved.json();
    expect(version).toBe(1);

    session = { ...session, userId: 'staff-lee', role: 'funeral_director' };
    const state = await (await getState()).json();
    expect(state).toMatchObject({ latest: { documentId, version: 1, values: { name: 'Juniper Fairweather' } }, latestMatchesCase: true });
    const file = await (await getSaved(documentId)).json();
    expect(file.labelXml).toContain('<Text>Juniper Fairweather</Text>');
    expect(file.isLatest).toBe(true);

    expect((await printed(documentId)).status).toBe(200);
    const events = activityEventFixtures.slice(lengths.activity).map((e) => [e.eventType, e.actorIdentityId]);
    expect(events).toEqual(expect.arrayContaining([['document.generated', 'staff-dana'], ['document.label_printed', 'staff-lee']]));
  });

  it('saving needs document permission; reading and printing need case read', async () => {
    canGenerateDocument.mockResolvedValueOnce(false);
    expect((await save(null)).status).toBe(403);
    expect(caseDocumentFixtures).toHaveLength(lengths.documents);

    const { documentId } = await (await save(null)).json();
    canReadCases.mockResolvedValue(false);
    expect((await getState()).status).toBe(403);
    expect((await getSaved(documentId)).status).toBe(403);
    expect((await printed(documentId)).status).toBe(403);
    canReadCases.mockResolvedValue(true);
  });

  it('refuses a save from another site, with a missing value, or over a label the caller never saw', async () => {
    expect((await save(null, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);

    caseFixtures[index] = { ...caseFixtures[index], tagNumber: null };
    const missing = await save(null);
    expect(missing.status).toBe(422);
    expect((await missing.json()).error).toBe("Can't print the label yet. Add the Tag # to this case first.");

    caseFixtures[index] = { ...caseFixtures[index], tagNumber: '90210' };
    const { documentId } = await (await save(null)).json();
    caseFixtures[index] = { ...caseFixtures[index], tagNumber: '90211' };
    expect((await save(null)).status).toBe(409);
    expect((await save(documentId)).status).toBe(201);
  });

  it('answers "unchanged" instead of saving a duplicate', async () => {
    const { documentId } = await (await save(null)).json();
    const again = await save(documentId);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ outcome: 'unchanged', documentId });
  });

  it('another organization, and an organization without an approved label, get nothing', async () => {
    expect((await getState(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    session = { ...session, organizationId: SECOND_MOCK_ORGANIZATION_ID };
    expect((await getState()).status).toBe(404);
    expect((await save(null)).status).toBe(404);
    expect(canReadCases).not.toHaveBeenCalled();
  });

  it('an unknown saved label is not found', async () => {
    expect((await getSaved('no-such-label')).status).toBe(404);
    expect((await printed('no-such-label')).status).toBe(404);
  });
});
