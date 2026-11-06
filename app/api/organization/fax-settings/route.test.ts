// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockAccountingUser, mockArrangerUser, mockDefaultUser, mockDispatchUser, mockFuneralDirectorUser, mockManagerUser, mockMultiOrgUser, mockOfficeStaffUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';

/**
 * Fax Settings routes (2026-11): administrators of the signed-in session's
 * own organization only, for an organization that faxes. Fictional values.
 */
let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const settingsRoute = await import('./route');
const destinationsRoute = await import('./destinations/route');
const destinationRoute = await import('./destinations/[destinationId]/route');
const archiveRoute = await import('./destinations/[destinationId]/archive/route');
const defaultRoute = await import('./destinations/[destinationId]/default/route');
const restoreRoute = await import('./destinations/[destinationId]/restore/route');
const historyRoute = await import('./history/route');
const { memoryFaxTable } = await import('@/services/faxBundles/faxBundleStore');
const { activityEventFixtures } = await import('@/services/__mocks__/activityEventFixtures');

const ORG = DEFAULT_ORGANIZATION_ID;
const HEADERS = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const as = (user: typeof mockDefaultUser | null) => (mockSession = user ? { user } : null);
const params = (destinationId: string) => ({ params: Promise.resolve({ destinationId }) });
const body = (value: unknown, headers = HEADERS) => ({ method: 'POST', headers, body: JSON.stringify(value) });

const getSettings = (org = ORG) => settingsRoute.GET(new Request(`http://localhost/api/organization/fax-settings?organizationId=${org}`));
const patchSettings = (settings: unknown, org = ORG, headers = HEADERS) => settingsRoute.PATCH(new Request('http://localhost/api/organization/fax-settings', { ...body({ organizationId: org, settings }, headers), method: 'PATCH' }));
const addDestination = (destination: unknown, org = ORG) => destinationsRoute.POST(new Request('http://localhost/api/organization/fax-settings/destinations', body({ organizationId: org, destination })));
const editDestination = (id: string, destination: unknown, org = ORG) => destinationRoute.PATCH(new Request(`http://localhost/x/${id}`, { ...body({ organizationId: org, destination }), method: 'PATCH' }), params(id));
const archive = (id: string, expectedRevision: unknown, org = ORG) => archiveRoute.POST(new Request(`http://localhost/x/${id}/archive`, body({ organizationId: org, expectedRevision })), params(id));
const restore = (id: string, expectedRevision: unknown, org = ORG) => restoreRoute.POST(new Request(`http://localhost/x/${id}/restore`, body({ organizationId: org, expectedRevision })), params(id));
const makeDefault = (id: string, expectedSettingsRevision: unknown, org = ORG) => defaultRoute.POST(new Request(`http://localhost/x/${id}/default`, body({ organizationId: org, expectedSettingsRevision })), params(id));
const getHistory = (org = ORG) => historyRoute.GET(new Request(`http://localhost/api/organization/fax-settings/history?organizationId=${org}`));

let activityLength = 0;
beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  as(mockDefaultUser);
  memoryFaxTable.reset();
  activityLength = activityEventFixtures.length;
});
afterEach(() => {
  delete process.env.DATA_ADAPTER;
  activityEventFixtures.length = activityLength;
});

describe('Fax Settings routes', () => {
  it('require a session and an organization the member belongs to', async () => {
    as(null);
    expect((await getSettings()).status).toBe(401);
    as(mockDefaultUser);
    expect((await getSettings(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    expect((await patchSettings({ expectedRevision: null, subjectTemplate: 'X {reference}' }, SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    expect((await settingsRoute.GET(new Request('http://localhost/api/organization/fax-settings'))).status).toBe(400);
  });

  it('an organization that does not fax has no Fax Settings, even for its own members', async () => {
    as(mockMultiOrgUser);
    expect((await getSettings(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(404);
  });

  it.each([
    ['Manager', mockManagerUser],
    ['Funeral Director', mockFuneralDirectorUser],
    ['Office Staff', mockOfficeStaffUser],
    ['Arranger', mockArrangerUser],
    ['Accounting', mockAccountingUser],
    ['Read Only', mockReadOnlyUser],
    ['Dispatch', mockDispatchUser],
  ])('%s can neither view nor change Fax Settings', async (_label, user) => {
    as(user);
    expect((await getSettings()).status).toBe(403);
    expect((await getHistory()).status).toBe(403);
    expect((await patchSettings({ expectedRevision: null, subjectTemplate: 'X {reference}' })).status).toBe(403);
    expect((await addDestination({ name: 'A', faxNumber: '3055550100' })).status).toBe(403);
    expect((await editDestination('builtin', { name: 'B' })).status).toBe(403);
    expect((await archive('fxd-' + '0'.repeat(32), 0)).status).toBe(403);
    expect((await restore('fxd-' + '0'.repeat(32), 0)).status).toBe(403);
    expect((await makeDefault('fxd-' + '0'.repeat(32), 0)).status).toBe(403);
    expect(memoryFaxTable.rows('faxSettings')).toHaveLength(0);
    expect(memoryFaxTable.rows('faxDestinations')).toHaveLength(0);
  });

  it('changes need a same-origin request', async () => {
    const noOrigin = { host: HEADERS.host, 'content-type': HEADERS['content-type'] };
    expect((await patchSettings({ expectedRevision: null, subjectTemplate: 'X {reference}' }, ORG, noOrigin as typeof HEADERS)).status).toBe(403);
    expect(memoryFaxTable.rows('faxSettings')).toHaveLength(0);
  });

  it('an administrator views, edits, adds, makes default, archives and reads the history', async () => {
    const first = await (await getSettings()).json();
    expect(first.overview).toMatchObject({ sendingEnabled: false, settings: { exists: false, revision: null }, destinations: [{ id: 'builtin', isDefault: true }] });

    const saved = await patchSettings({ expectedRevision: null, subjectTemplate: 'Manors Cremation DC {reference}' });
    expect(saved.status).toBe(200);
    expect((await saved.json()).overview.settings).toMatchObject({ exists: true, revision: 1 });
    expect((await patchSettings({ expectedRevision: null, subjectTemplate: 'Again {reference}' })).status).toBe(409);
    expect((await patchSettings({ expectedRevision: 1, sendingEnabled: true })).status).toBe(400);
    expect((await patchSettings({ expectedRevision: 1, bodyEnabled: true, bodyTemplate: 'Hello' })).status).toBe(400);
    expect((await patchSettings({ expectedRevision: 1, coverPageEnabled: true })).status).toBe(400);

    const added = await addDestination({ name: 'Sarasota County Records', faxNumber: '941-555-0177' });
    expect(added.status).toBe(201);
    const overview = (await added.json()).overview;
    const sarasota = overview.destinations.find((d: { name: string }) => d.name === 'Sarasota County Records');
    expect((await addDestination({ name: 'Bad', faxNumber: '555-0177' })).status).toBe(400);
    expect((await editDestination(sarasota.id, { expectedRevision: sarasota.revision, purpose: 'Amendments' })).status).toBe(200);
    expect((await makeDefault(sarasota.id, 0)).status).toBe(409); // stale settings revision
    const fresh = (await (await getSettings()).json()).overview;
    expect((await makeDefault(sarasota.id, fresh.settings.revision)).status).toBe(200);
    const manatee = fresh.destinations.find((d: { name: string }) => d.name === 'Manatee County Vital Statistics');
    expect((await archive(manatee.id, manatee.revision)).status).toBe(200);
    expect((await archive('fxd-' + 'f'.repeat(32), 0)).status).toBe(404);
    const archived = (await (await getSettings()).json()).overview.destinations.find((d: { id: string }) => d.id === manatee.id);
    expect(archived.status).toBe('archived');
    expect((await restore(manatee.id, archived.revision)).status).toBe(200);
    expect((await restore('fxd-' + 'f'.repeat(32), 0)).status).toBe(404);

    const history = (await (await getHistory()).json()).history as Array<{ eventType: string }>;
    expect(history.map((h) => h.eventType)).toEqual(expect.arrayContaining(['fax_settings.updated', 'fax_destination.created', 'fax_destination.updated', 'fax_destination.default_changed', 'fax_destination.archived', 'fax_destination.restored']));
  });
});
