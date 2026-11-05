// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join } from 'path';

/**
 * Fax Settings (2026-11), mock mode. Fictional destinations only; nothing
 * is sent anywhere. A second, fictional organization with faxing is added
 * so isolation can be shown between two organizations that both fax.
 */
const OTHER = 'zz-other-fax-home';
vi.mock('@/domain/faxBundles/faxSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/faxBundles/faxSettings')>();
  return {
    ...actual,
    deathCertificateFaxSettings: (organizationId: string | null | undefined) =>
      organizationId === OTHER
        ? { destinationName: 'Other County Records', faxNumber: '3055550123', gatewayDomain: 'fax.nuso.io', emailOrganizationName: 'Other Home', maxAttachmentBytes: 1_000_000, sendingEnabled: false }
        : actual.deathCertificateFaxSettings(organizationId),
  };
});

const service = await import('./faxSettingsService');
const { memoryFaxTable, setFaxTableForTesting } = await import('../faxBundles/faxBundleStore');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } = await import('../__mocks__/organizationIds');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('../crematory/crematoryMailboxService');
type ServiceError = InstanceType<typeof service.FaxSettingsServiceError>;

const ORG = DEFAULT_ORGANIZATION_ID;
const ctx = (role = 'administrator', organizationId = ORG, actor = 'staff-dana') => ({ organizationId, actorIdentityId: actor, actorMembershipId: null, actorRoleKey: role, correlationId: 'corr' });
const err = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as ServiceError);

let activityLength = 0;
beforeEach(() => {
  memoryFaxTable.reset();
  setFaxTableForTesting(null);
  resetMockCrematoryMailboxes();
  activityLength = activityEventFixtures.length;
});
afterEach(() => {
  activityEventFixtures.length = activityLength;
});
const events = () => activityEventFixtures.slice(activityLength);

describe('built-in values: nothing saved means nothing changes', () => {
  it('Manors resolves to exactly what was sent before Fax Settings existed', async () => {
    const config = await service.resolveFaxConfiguration(ORG, 'mock');
    expect(config).toMatchObject({
      provider: { key: 'nuso', gatewayDomain: 'fax.nuso.io' },
      destination: { id: null, name: 'Manatee County Vital Statistics', faxNumber: '9415545490', address: '9415545490@fax.nuso.io', builtIn: true },
      subjectTemplate: 'Manors Cremation - DC Application Bundle {reference}',
      bodyEnabled: false,
      bodyInUse: false,
      coverPageEnabled: false,
      settingsRevision: null,
      sendingEnabled: false,
    });
    expect(service.renderBundleEmail(config, { reference: 'DC-7Q4K9M', applicationCount: 2, pageCount: 2 })).toEqual({ subject: 'Manors Cremation - DC Application Bundle DC-7Q4K9M', body: '' });
  });

  it('before the Wix migration (collections missing → HTTP 404 WDE0025): the built-in values apply; other errors are not hidden', async () => {
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    const failing = (status: number) => ({
      ...memoryFaxTable,
      find: async () => {
        throw new WixDataApiError('WDE0025: The faxSettings collection does not exist.', status);
      },
    });
    setFaxTableForTesting(failing(404));
    expect((await service.resolveFaxConfiguration(ORG, 'wix')).destination).toMatchObject({ builtIn: true, address: '9415545490@fax.nuso.io' });
    setFaxTableForTesting(failing(500));
    await expect(service.resolveFaxConfiguration(ORG, 'wix')).rejects.toThrow(/does not exist/);
  });

  it('an organization that does not fax has no Fax Settings (Gus)', async () => {
    expect((await err(service.resolveFaxConfiguration(GUS_ORGANIZATION_ID, 'mock')))?.status).toBe(404);
    expect((await err(service.getFaxSettingsOverview(GUS_ORGANIZATION_ID, 'mock')))?.status).toBe(404);
  });

  it('the overview shows the built-in destination as the default, the mailbox address and no token', async () => {
    connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'secret-access-token');
    const overview = await service.getFaxSettingsOverview(ORG, 'mock');
    expect(overview.destinations).toEqual([expect.objectContaining({ id: 'builtin', builtIn: true, isDefault: true, faxNumberDisplay: '941-554-5490', address: '9415545490@fax.nuso.io' })]);
    expect(overview.mailbox).toEqual({ connected: true, configured: expect.any(Boolean), accountEmail: 'office@funeralhome.example', needsReconnect: false });
    expect(JSON.stringify(overview)).not.toContain('secret-access-token');
    expect(overview.effective).toEqual({ destinationName: 'Manatee County Vital Statistics', address: '9415545490@fax.nuso.io', subjectExample: 'Manors Cremation - DC Application Bundle DC-7Q4K9M', bodyInUse: false });
    expect(overview.provider).toMatchObject({ key: 'nuso', emailBody: 'unverified', coverPage: 'unsupported' });
  });
});

describe('administrators only — checked by the service itself', () => {
  it.each(['manager', 'funeralDirector', 'officeStaff', 'arranger', 'accounting', 'readOnly', 'dispatch'])('%s cannot change anything', async (role) => {
    const c = ctx(role);
    for (const attempt of [
      service.updateFaxSettings(c, { expectedRevision: null, subjectTemplate: 'X {reference}' }, 'mock'),
      service.createFaxDestination(c, { name: 'A', faxNumber: '3055550100' }, 'mock'),
      service.updateFaxDestination(c, 'builtin', { name: 'B' }, 'mock'),
      service.setDefaultFaxDestination(c, 'fxd-' + '0'.repeat(32), 0, 'mock'),
      service.archiveFaxDestination(c, 'fxd-' + '0'.repeat(32), 0, 'mock'),
    ]) {
      expect((await err(attempt))?.status).toBe(403);
    }
    expect(memoryFaxTable.rows('faxSettings')).toHaveLength(0);
    expect(memoryFaxTable.rows('faxDestinations')).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it('no actor or no role is refused too', async () => {
    expect((await err(service.updateFaxSettings({ ...ctx(), actorRoleKey: null }, { expectedRevision: null }, 'mock')))?.status).toBe(403);
    expect((await err(service.updateFaxSettings({ ...ctx(), actorIdentityId: null }, { expectedRevision: null }, 'mock')))?.status).toBe(403);
  });
});

describe('destinations', () => {
  it('editing the built-in destination stores it (still the default) with the change, audited', async () => {
    const overview = await service.updateFaxDestination(ctx(), 'builtin', { name: 'Manatee County Vital Statistics (DC unit)' }, 'mock');
    const [stored] = overview.destinations;
    expect(stored).toMatchObject({ builtIn: false, isDefault: true, name: 'Manatee County Vital Statistics (DC unit)', faxNumber: '9415545490', revision: 1 });
    expect(overview.destinations).toHaveLength(1);
    expect(events().map((e) => e.eventType)).toEqual(['fax_destination.created', 'fax_destination.default_changed', 'fax_destination.updated']);
    expect(events().every((e) => e.category === 'administration' && e.caseId === null && e.actorIdentityId === 'staff-dana')).toBe(true);
    expect(JSON.parse(events()[2].previousValue!)).toEqual({ name: 'Manatee County Vital Statistics' });
  });

  it('adding a destination keeps the built-in one as the default unless asked; making another the default moves it in one step', async () => {
    let overview = await service.createFaxDestination(ctx(), { name: 'Sarasota County Records', faxNumber: '(941) 555-0177', purpose: 'Amendments' }, 'mock');
    expect(overview.destinations.map((d) => [d.name, d.faxNumber, d.isDefault])).toEqual([
      ['Manatee County Vital Statistics', '9415545490', true],
      ['Sarasota County Records', '9415550177', false],
    ]);
    const sarasota = overview.destinations[1];
    overview = await service.setDefaultFaxDestination(ctx(), sarasota.id, overview.settings.revision, 'mock');
    expect(overview.destinations.filter((d) => d.isDefault).map((d) => d.name)).toEqual(['Sarasota County Records']);
    expect((await service.resolveFaxConfiguration(ORG, 'mock')).destination).toMatchObject({ id: sarasota.id, address: '9415550177@fax.nuso.io', builtIn: false });
  });

  it('validates fax numbers before saving', async () => {
    for (const faxNumber of ['', '12345', '941-554-549', '041-554-5490', '941-154-5490', '941-554-5490 ext 2', 'abc']) {
      expect((await err(service.createFaxDestination(ctx(), { name: 'X', faxNumber }, 'mock')))?.status).toBe(400);
    }
    expect((await err(service.createFaxDestination(ctx(), { name: '', faxNumber: '3055550100' }, 'mock')))?.message).toMatch(/name is required/);
    const ok = await service.createFaxDestination(ctx(), { name: 'Plus one', faxNumber: '+1 305.555.0100' }, 'mock');
    expect(ok.destinations.some((d) => d.faxNumber === '3055550100')).toBe(true);
    expect((await err(service.createFaxDestination(ctx(), { name: 'Again', faxNumber: '305-555-0100' }, 'mock')))?.status).toBe(409);
  });

  it('the default cannot be archived; another can, and is kept (never deleted)', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'Old agency', faxNumber: '3055550100' }, 'mock');
    const [builtIn, old] = overview.destinations;
    expect((await err(service.archiveFaxDestination(ctx(), builtIn.id, builtIn.revision, 'mock')))?.status).toBe(409);
    const after = await service.archiveFaxDestination(ctx(), old.id, old.revision, 'mock');
    expect(after.destinations.find((d) => d.id === old.id)).toMatchObject({ status: 'archived', isDefault: false });
    expect(memoryFaxTable.rows('faxDestinations')).toHaveLength(2);
    expect((await err(service.setDefaultFaxDestination(ctx(), old.id, after.settings.revision, 'mock')))?.status).toBe(409);
    expect((await err(service.updateFaxDestination(ctx(), old.id, { expectedRevision: 1, name: 'Renamed' }, 'mock')))?.status).toBe(409);
  });

  it('two administrators at once: the second is told it changed — never two defaults', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'B', faxNumber: '3055550100' }, 'mock');
    const second = await service.createFaxDestination(ctx(), { name: 'C', faxNumber: '3055550101' }, 'mock');
    const [, b, c] = second.destinations;
    const revision = second.settings.revision;
    const results = await Promise.allSettled([
      service.setDefaultFaxDestination(ctx(), b.id, revision, 'mock'),
      service.setDefaultFaxDestination(ctx('administrator', ORG, 'staff-lee'), c.id, revision, 'mock'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as ServiceError).status).toBe(409);
    expect((await service.getFaxSettingsOverview(ORG, 'mock')).destinations.filter((d) => d.isDefault)).toHaveLength(1);
    expect(overview).toBeTruthy();
    // A stale edit of a destination is refused the same way.
    expect((await err(service.updateFaxDestination(ctx(), b.id, { expectedRevision: b.revision! + 5, name: 'Z' }, 'mock')))?.status).toBe(409);
  });

  it('an archived default (left by a race) stops previews with a clear message instead of faxing somewhere else', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'B', faxNumber: '3055550100', makeDefault: true }, 'mock');
    const b = overview.destinations.find((d) => d.isDefault)!;
    // Simulate the race outcome directly in storage.
    await memoryFaxTable.patchIf('faxDestinations', b.id, { status: 'archived' }, { revision: b.revision });
    expect((await err(service.resolveFaxConfiguration(ORG, 'mock')))).toMatchObject({ status: 409, message: expect.stringMatching(/default fax destination is no longer available/) });
  });
});

describe('organization isolation', () => {
  it('each organization has its own destinations and settings; another organization\'s ids do not exist for it', async () => {
    const mine = await service.createFaxDestination(ctx(), { name: 'Mine', faxNumber: '3055550100' }, 'mock');
    const theirs = await service.createFaxDestination(ctx('administrator', OTHER), { name: 'Theirs', faxNumber: '3055550199' }, 'mock');
    const myId = mine.destinations.find((d) => d.name === 'Mine')!.id;
    const theirId = theirs.destinations.find((d) => d.name === 'Theirs')!.id;

    expect(mine.destinations.map((d) => d.name)).not.toContain('Theirs');
    expect(theirs.destinations.map((d) => d.name)).toEqual(['Other County Records', 'Theirs']);
    for (const attempt of [
      service.updateFaxDestination(ctx(), theirId, { expectedRevision: 0, faxNumber: '3055550111' }, 'mock'),
      service.archiveFaxDestination(ctx(), theirId, 0, 'mock'),
      service.setDefaultFaxDestination(ctx(), theirId, mine.settings.revision, 'mock'),
      service.updateFaxDestination(ctx('administrator', OTHER), myId, { expectedRevision: 0, name: 'Hijacked' }, 'mock'),
    ]) {
      expect((await err(attempt))?.status).toBe(404);
    }
    expect((await service.resolveFaxConfiguration(OTHER, 'mock')).subjectTemplate).toBe('Other Home - DC Application Bundle {reference}');
    expect((await service.resolveFaxConfiguration(ORG, 'mock')).destination.name).toBe('Manatee County Vital Statistics');
    const history = await service.listFaxConfigurationHistory(ORG, 'mock');
    expect(history.some((h) => h.description.includes('Theirs'))).toBe(false);
  });
});

describe('subject, message and cover page', () => {
  it('saves a subject; it must be one line, plain, include {reference} and use only known placeholders', async () => {
    const saved = await service.updateFaxSettings(ctx(), { expectedRevision: null, subjectTemplate: '{organizationName} DC applications ({applicationCount}) {reference}' }, 'mock');
    expect(saved.settings).toMatchObject({ exists: true, revision: 1, subjectTemplate: '{organizationName} DC applications ({applicationCount}) {reference}' });
    expect(saved.effective?.subjectExample).toBe('Manors Cremation DC applications (3) DC-7Q4K9M');
    for (const [subjectTemplate, message] of [
      ['No reference here', /must include \{reference\}/],
      ['Bundle {reference}\nBcc: x@example.com', /single line/],
      ['{decedentName} {reference}', /never include decedent/],
      ['{caseNumber} {reference}', /never include decedent/],
      ['{whatever} {reference}', /not a placeholder SOLIS knows/],
      ['{reference', /unmatched/],
      ['x'.repeat(151) + '{reference}', /at most 150/],
      ['', /required/],
    ] as const) {
      expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 1, subjectTemplate }, 'mock')))?.message).toMatch(message);
    }
    expect((await service.getFaxSettingsOverview(ORG, 'mock')).settings.revision).toBe(1);
  });

  it('NuSo: the message can be drafted but not turned on; a cover page is never available', async () => {
    const draft = await service.updateFaxSettings(ctx(), { expectedRevision: null, bodyTemplate: 'Please process the attached {applicationCount} applications.\r\nThank you.' }, 'mock');
    expect(draft.settings).toMatchObject({ bodyEnabled: false, bodyTemplate: 'Please process the attached {applicationCount} applications.\nThank you.' });
    expect((await service.resolveFaxConfiguration(ORG, 'mock')).bodyInUse).toBe(false);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 1, bodyEnabled: true }, 'mock')))?.message).toMatch(/has not been verified/);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 1, coverPageEnabled: true }, 'mock')))?.message).toMatch(/no verified cover page option/);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 1, bodyTemplate: '<b>hi</b>' }, 'mock')))?.message).toMatch(/plain text/);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 1, bodyTemplate: 'For {decedent} please' }, 'mock')))?.message).toMatch(/never include decedent/);
    // Even a body stored as enabled (e.g. written outside SOLIS) is never used with an unverified provider.
    const [row] = memoryFaxTable.rows('faxSettings');
    await memoryFaxTable.patchIf('faxSettings', row.beaconFaxSettingsId as string, { bodyEnabled: true, coverPageEnabled: true }, { revision: row.revision });
    const config = await service.resolveFaxConfiguration(ORG, 'mock');
    expect(config).toMatchObject({ bodyInUse: false, coverPageEnabled: false });
    expect(service.renderBundleEmail(config, { reference: 'DC-AAAAAA', applicationCount: 1, pageCount: 1 }).body).toBe('');
  });

  it('fax sending can never be turned on from Fax Settings, and unknown settings are refused', async () => {
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: null, sendingEnabled: true }, 'mock')))?.message).toMatch(/cannot be turned on from Fax Settings/);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: null, maxAttachmentBytes: 99 }, 'mock')))?.status).toBe(400);
    expect((await err(service.createFaxDestination(ctx(), { name: 'A', faxNumber: '3055550100', sendingEnabled: true }, 'mock')))?.status).toBe(400);
    expect((await service.resolveFaxConfiguration(ORG, 'mock')).sendingEnabled).toBe(false);
    expect(memoryFaxTable.rows('faxSettings')).toHaveLength(0);
  });

  it('only approved providers', async () => {
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: null, providerKey: 'evil' }, 'mock')))?.message).toMatch(/approved fax provider/);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: null, providerKey: 'toString' }, 'mock')))?.status).toBe(400);
  });

  it('a stale save is refused; the first save of an organization is expectedRevision null', async () => {
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 0, subjectTemplate: 'A {reference}' }, 'mock')))?.status).toBe(409);
    await service.updateFaxSettings(ctx(), { expectedRevision: null, subjectTemplate: 'A {reference}' }, 'mock');
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: null, subjectTemplate: 'B {reference}' }, 'mock')))?.status).toBe(409);
    expect((await err(service.updateFaxSettings(ctx(), { expectedRevision: 0, subjectTemplate: 'B {reference}' }, 'mock')))?.status).toBe(409);
  });

  it('the history lists every change with who made it, newest first', async () => {
    await service.updateFaxSettings(ctx(), { expectedRevision: null, subjectTemplate: 'A {reference}' }, 'mock');
    await service.createFaxDestination(ctx(), { name: 'Second', faxNumber: '3055550100' }, 'mock');
    const history = await service.listFaxConfigurationHistory(ORG, 'mock');
    expect(history.map((h) => h.eventType)).toEqual(expect.arrayContaining(['fax_settings.updated', 'fax_destination.created', 'fax_destination.default_changed']));
    expect(history.some((h) => /Fax destination added: Second \(305-555-0100\)/.test(h.description))).toBe(true);
    expect(history.every((h, i) => i === 0 || history[i - 1].at >= h.at)).toBe(true);
    expect(history.find((h) => h.eventType === 'fax_settings.updated')?.description).toBe('Fax Settings changed: email subject');
  });
});

describe('archive and restore (2026-11)', () => {
  it('an archived destination can be restored — active again, not the default, audited', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'Old agency', faxNumber: '3055550100' }, 'mock');
    const old = overview.destinations.find((d) => d.name === 'Old agency')!;
    const archived = (await service.archiveFaxDestination(ctx(), old.id, old.revision, 'mock')).destinations.find((d) => d.id === old.id)!;
    const restored = await service.restoreFaxDestination(ctx(), old.id, archived.revision, 'mock');
    expect(restored.destinations.find((d) => d.id === old.id)).toMatchObject({ status: 'active', isDefault: false });
    expect(restored.destinations.filter((d) => d.isDefault).map((d) => d.name)).toEqual(['Manatee County Vital Statistics']);
    expect(events().at(-1)).toMatchObject({ eventType: 'fax_destination.restored', description: 'Fax destination restored: Old agency (305-555-0100)', actorIdentityId: 'staff-dana' });
    // A stale restore is refused; restoring an active one changes nothing.
    expect((await err(service.restoreFaxDestination(ctx(), old.id, archived.revision, 'mock')))?.status).toBe(409);
  });

  it('a restore that would duplicate an active number is refused; non-administrators cannot restore', async () => {
    let overview = await service.createFaxDestination(ctx(), { name: 'Old agency', faxNumber: '3055550100' }, 'mock');
    const old = overview.destinations.find((d) => d.name === 'Old agency')!;
    overview = await service.archiveFaxDestination(ctx(), old.id, old.revision, 'mock');
    await service.createFaxDestination(ctx(), { name: 'New agency, same number', faxNumber: '305-555-0100' }, 'mock');
    const archivedRevision = overview.destinations.find((d) => d.id === old.id)!.revision;
    expect((await err(service.restoreFaxDestination(ctx(), old.id, archivedRevision, 'mock')))?.message).toMatch(/already an active destination/);
    expect((await err(service.restoreFaxDestination(ctx('funeral_director'), old.id, archivedRevision, 'mock')))?.status).toBe(403);
    expect((await err(service.restoreFaxDestination(ctx(), 'builtin', 0, 'mock')))?.status).toBe(404);
  });

  it('the last usable destination is never archived: the default stays active, always', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'Second', faxNumber: '3055550100' }, 'mock');
    const [manatee, second] = overview.destinations;
    // The default (and therefore the last one standing) cannot be archived.
    expect((await err(service.archiveFaxDestination(ctx(), manatee.id, manatee.revision, 'mock')))?.message).toMatch(/default destination/);
    // A non-default can, because the default remains.
    const after = await service.archiveFaxDestination(ctx(), second.id, second.revision, 'mock');
    expect(after.destinations.filter((d) => d.status === 'active').map((d) => d.name)).toEqual(['Manatee County Vital Statistics']);
    expect((await service.resolveFaxConfiguration(ORG, 'mock')).destination.name).toBe('Manatee County Vital Statistics');
  });
});

describe('choosing a destination per bundle (2026-11)', () => {
  it('lists only this organization\'s active destinations on its provider, default first; with nothing stored, the built-in one', async () => {
    expect(await service.listSendableFaxDestinations(ORG, 'mock')).toEqual([{ id: 'builtin', name: 'Manatee County Vital Statistics', faxNumberDisplay: '941-554-5490', isDefault: true }]);
    let overview = await service.createFaxDestination(ctx(), { name: 'Sarasota County Records', faxNumber: '9415550177' }, 'mock');
    overview = await service.createFaxDestination(ctx(), { name: 'Archived agency', faxNumber: '3055550100' }, 'mock');
    const archived = overview.destinations.find((d) => d.name === 'Archived agency')!;
    await service.archiveFaxDestination(ctx(), archived.id, archived.revision, 'mock');
    await service.createFaxDestination(ctx('administrator', OTHER), { name: 'Other home only', faxNumber: '3055550199' }, 'mock');
    const list = await service.listSendableFaxDestinations(ORG, 'mock');
    expect(list.map((d) => [d.name, d.faxNumberDisplay, d.isDefault])).toEqual([
      ['Manatee County Vital Statistics', '941-554-5490', true],
      ['Sarasota County Records', '941-555-0177', false],
    ]);
    expect(list.every((d) => !('address' in d))).toBe(true);
  });

  it('resolves a chosen destination; another organization\'s, an archived or an unknown one is refused', async () => {
    const overview = await service.createFaxDestination(ctx(), { name: 'Sarasota County Records', faxNumber: '9415550177' }, 'mock');
    const sarasota = overview.destinations.find((d) => d.name === 'Sarasota County Records')!;
    expect((await service.resolveFaxConfiguration(ORG, 'mock', sarasota.id)).destination).toMatchObject({ id: sarasota.id, name: 'Sarasota County Records', address: '9415550177@fax.nuso.io' });
    // Omitted / null / 'builtin' = the default.
    for (const choice of [undefined, null, 'builtin']) expect((await service.resolveFaxConfiguration(ORG, 'mock', choice)).destination.name).toBe('Manatee County Vital Statistics');
    // The other organization cannot use Manors' destination, and vice versa.
    expect((await err(service.resolveFaxConfiguration(OTHER, 'mock', sarasota.id)))?.status).toBe(404);
    const theirs = (await service.createFaxDestination(ctx('administrator', OTHER), { name: 'Theirs', faxNumber: '3055550199' }, 'mock')).destinations.find((d) => d.name === 'Theirs')!;
    expect((await err(service.resolveFaxConfiguration(ORG, 'mock', theirs.id)))?.status).toBe(404);
    expect((await err(service.resolveFaxConfiguration(ORG, 'mock', 'fxd-00000000000000000000000000000000')))?.status).toBe(404);
    await service.archiveFaxDestination(ctx(), sarasota.id, sarasota.revision, 'mock');
    expect((await err(service.resolveFaxConfiguration(ORG, 'mock', sarasota.id)))?.message).toMatch(/archived/);
  });
});

describe('audit identity (2026-11)', () => {
  it('each change records the signed-in administrator\'s identity id; the history names them from the identity record — and says nothing it does not know', async () => {
    const { MANORS_ADMIN_IDENTITY_ID, identityFixtures } = await import('../__mocks__/identityFixtures');
    const name = identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID)!.displayName;
    await service.updateFaxSettings(ctx('administrator', ORG, MANORS_ADMIN_IDENTITY_ID), { expectedRevision: null, subjectTemplate: 'Signed in {reference}' }, 'mock');
    expect(events().at(-1)).toMatchObject({ eventType: 'fax_settings.updated', actorIdentityId: MANORS_ADMIN_IDENTITY_ID });
    let history = await service.listFaxConfigurationHistory(ORG, 'mock');
    expect(history[0]).toMatchObject({ eventType: 'fax_settings.updated', actor: name });
    // An actor id that is not an identity (local mock sign-in) is never given someone's name.
    await service.createFaxDestination(ctx('administrator', ORG, 'mock-user-dana'), { name: 'Second', faxNumber: '3055550100' }, 'mock');
    history = await service.listFaxConfigurationHistory(ORG, 'mock');
    expect(history.filter((h) => h.eventType.startsWith('fax_destination.')).every((h) => h.actor === null)).toBe(true);
  });
});

describe('Fax Settings orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) walk(fullPath, results);
      else if (['.ts', '.tsx'].includes(extname(fullPath)) && !/\.test\.tsx?$/.test(fullPath)) results.push(fullPath);
    }
    return results;
  }
  const root = join(__dirname, '..', '..');
  const files = walk(root);
  const servicePath = join(__dirname, 'faxSettingsService.ts');
  const storePath = join(__dirname, 'faxSettingsStore.ts');

  it('only faxSettingsService.ts imports the Fax Settings store (the only writer of faxDestinations / faxSettings)', () => {
    const offenders = files.filter((f) => f !== servicePath && /from ['"][^'"]*faxSettingsStore['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no other module that touches storage names the two collections', () => {
    const offenders = files.filter((f) => {
      // activityService.ts uses 'faxSettings' only as an audit resourceType.
      if (f === storePath || f === join(root, 'services', 'activityService.ts')) return false;
      const source = readFileSync(f, 'utf8');
      return /['"](faxDestinations|faxSettings)['"]/.test(source) && /wixDataApi|faxTableFor|memoryFaxTable|createMemoryTable/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('only faxSettingsService.ts records fax_settings.* / fax_destination.* audit events', () => {
    const activityPath = join(root, 'services', 'activityService.ts');
    const offenders = files.filter((f) => f !== servicePath && f !== activityPath && /recordFaxConfigurationEvent/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('routes delegate: they never import the store, the activity service or the Wix API', () => {
    const routes = files.filter((f) => f.includes(join('app', 'api', 'organization', 'fax-settings')));
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const route of routes) expect(readFileSync(route, 'utf8')).not.toMatch(/faxSettingsStore|activityService|wixDataApi/);
  });
});
