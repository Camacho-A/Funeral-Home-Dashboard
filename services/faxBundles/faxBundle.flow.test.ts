// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import type { Case } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';
import type { Appointment } from '@/types/appointment';

/**
 * Manatee County DC application fax bundles (2026-11), end to end in mock
 * mode: fictional cases and applications, document storage in memory,
 * Microsoft Graph faked. Nothing leaves the test; no real fax number other
 * than the configured gateway address is ever "contacted" (the fake).
 */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock('../../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer, contentType: string) => (blobs.set(key, { buffer: Buffer.from(contents), contentType }), { storageKey: key }),
    downloadFile: async (key: string) => {
      const blob = blobs.get(key);
      if (!blob) throw new Error(`no blob ${key}`);
      return { buffer: Buffer.from(blob.buffer), contentType: blob.contentType };
    },
    deleteFile: async (key: string) => void blobs.delete(key),
  },
}));

/** Sending is off in Manors' real profile; these tests turn it on (and can lower the size limit). */
const faxFlags = vi.hoisted(() => ({ sending: true, maxAttachmentBytes: null as number | null }));
vi.mock('@/domain/faxBundles/faxSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/faxBundles/faxSettings')>();
  return {
    ...actual,
    deathCertificateFaxSettings: (organizationId: string | null | undefined) => {
      const settings = actual.deathCertificateFaxSettings(organizationId);
      return settings ? { ...settings, sendingEnabled: faxFlags.sending, maxAttachmentBytes: faxFlags.maxAttachmentBytes ?? settings.maxAttachmentBytes } : null;
    },
  };
});

const service = await import('./faxBundleService');
const store = await import('./faxBundleStore');
type FaxBundleError = import('./faxBundleError').FaxBundleError;
const { buildManateeApplicationPdf } = await import('../manateeApplicationTemplate');
const { buildManateeTemplateFixture } = await import('../__mocks__/manateeTemplateFixture');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('../crematory/crematoryMailboxService');
const { caseFixtures } = await import('../__mocks__/fixtures');
const { caseDocumentFixtures } = await import('../__mocks__/documentFixtures');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { appointmentFixtures } = await import('../__mocks__/schedulingFixtures');
const { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } = await import('../__mocks__/organizationIds');
const { REQUEST_BOXES } = await import('./faxBundlePdf');

const ORG = DEFAULT_ORGANIZATION_ID;
const MAILBOX = 'office@funeralhome.example';
const GATEWAY = '9415545490@fax.nuso.io';
const ctx = (role = 'administrator', actor = 'staff-dana') => ({ organizationId: ORG, actorIdentityId: actor, actorMembershipId: null, actorRoleKey: role, correlationId: 'corr' });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM'];

// ---------------------------------------------------------------- fixtures

let template: Uint8Array;
const base = () => caseFixtures.find((c) => c.id === '1042' && c.organizationId === ORG)!;
const added: string[] = [];

function addCase(n: number, overrides: Partial<Case> = {}): string {
  const id = `fx-case-${n}`;
  caseFixtures.push({ ...structuredClone(base()), id, caseNumber: `B2026-9${String(n).padStart(2, '0')}`, decedentName: `${NAMES[n - 1]} TESTCASE`, isDeleted: false, checklistState: {}, checklistCompletions: {}, ...overrides });
  added.push(id);
  return id;
}

async function applicationPdf(first: string, request: [string, string] = ['', '']): Promise<Uint8Array> {
  return buildManateeApplicationPdf(template, {
    decedentFirst: first, decedentMiddle: '', decedentLast: 'Testcase', decedentSex: 'F', ssn: '000123456', ssnNotKnown: false,
    dateOfDeath: '10/04/2026', placeOfDeathCity: 'Pembroke Pines', placeOfDeathCounty: 'Broward', spouseFirst: '', spouseMiddle: '', spouseLast: '',
    representedName: 'Teresa Testcase', representedRelationship: 'Daughter', withCause: 1, withoutCause: 0, fedexFee: false, requestNumber: request[0], requestOf: request[1],
  });
}

let documentCounter = 0;
function saveApplication(caseId: string, bytes: Uint8Array, version = 1, organizationId = ORG): CaseDocument {
  const id = `fx-doc-${++documentCounter}`;
  const storageKey = `${organizationId}/${caseId}/${id}.pdf`;
  blobs.set(storageKey, { buffer: Buffer.from(bytes), contentType: 'application/pdf' });
  for (const d of caseDocumentFixtures) if (d.caseId === caseId && d.documentTypeKey === 'vital_records.manatee_death_certificate_application' && d.status === 'active') d.status = 'superseded';
  const document = {
    id, organizationId, caseId, origin: 'generated', documentTypeKey: 'vital_records.manatee_death_certificate_application', category: 'internal_form',
    fileName: 'Manatee County Death Certificate Application.pdf', mimeType: 'application/pdf', fileSizeBytes: bytes.byteLength, storageKey, status: 'active',
    templateId: null, templateVersion: null, version, supersedesId: null, signatureStatus: null, familyVisible: false, generatedBy: 'staff-dana', uploadedBy: null,
    createdAt: new Date(Date.now() - 60_000 + documentCounter).toISOString(), checksumSha256: sha256(bytes),
  } as unknown as CaseDocument;
  caseDocumentFixtures.push(document);
  return document;
}

async function casesWithApplications(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const id = addCase(n);
    saveApplication(id, await applicationPdf(NAMES[n - 1][0] + NAMES[n - 1].slice(1).toLowerCase()));
    ids.push(id);
  }
  return ids;
}

function expectedPickup(caseId: string, isoDate: string) {
  appointmentFixtures.push({ id: `cremains-pickup-${caseId}`, organizationId: ORG, caseId, appointmentType: 'cremains.pickup.expected', title: 'Expected pickup', status: 'scheduled', startAt: `${isoDate}T05:00:00.000Z`, endAt: `${isoDate}T23:00:00.000Z`, timezone: 'America/New_York' } as unknown as Appointment);
}

// ---------------------------------------------------------------- fake Graph

type GraphCall = { method: string; path: string; body: unknown };
function fakeGraph(behaviour: { createStatus?: number; sendStatus?: number; sendThrows?: boolean } = {}) {
  const calls: GraphCall[] = [];
  let drafts = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://graph.microsoft.com/v1.0', '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method: init?.method ?? 'GET', path, body });
    if (path === '/me/messages' && init?.method === 'POST') {
      if (behaviour.createStatus) return new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: behaviour.createStatus });
      return new Response(JSON.stringify({ id: `draft-${++drafts}`, internetMessageId: `<msg-${drafts}@example>` }), { status: 201 });
    }
    if (path.endsWith('/attachments') && init?.method === 'POST') return new Response('{}', { status: 201 });
    if (path.endsWith('/send')) {
      if (behaviour.sendThrows) throw new TypeError('fetch failed');
      return new Response(null, { status: behaviour.sendStatus ?? 202 });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const emails = () => calls.filter((c) => c.path === '/me/messages' && c.method === 'POST');
  const sends = () => calls.filter((c) => c.path.endsWith('/send'));
  const attachments = () => calls.filter((c) => c.path.endsWith('/attachments')).map((c) => c.body as { name: string; contentType: string; contentBytes: string });
  return { calls, emails, sends, attachments };
}

// ---------------------------------------------------------------- PDF reading

async function textItems(bytes: Uint8Array, pageNumber: number) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  try {
    const content = await (await doc.getPage(pageNumber)).getTextContent();
    return (content.items as Array<{ str: string; transform: number[] }>).filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
  } finally {
    await task.destroy();
  }
}
const inBox = (item: { x: number; y: number }, box: (typeof REQUEST_BOXES)[number]) => item.x >= box.x - 1 && item.x <= box.x + box.width && item.y >= box.y - 2 && item.y <= box.y + box.height;
async function requestNumbers(bytes: Uint8Array, pageNumber: number): Promise<[string, string]> {
  const items = await textItems(bytes, pageNumber);
  return [REQUEST_BOXES[0], REQUEST_BOXES[1]].map((box) => items.filter((i) => inBox(i, box)).map((i) => i.str).join('')) as [string, string];
}
async function firstNameOnPage(bytes: Uint8Array, pageNumber: number): Promise<string | undefined> {
  const items = await textItems(bytes, pageNumber);
  return items.map((i) => i.str).find((s) => NAMES.some((n) => s.toUpperCase() === n));
}

// ---------------------------------------------------------------- lifecycle

let lengths = { documents: 0, activity: 0, appointments: 0, cases: 0 };
beforeEach(async () => {
  template ??= await buildManateeTemplateFixture();
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length, appointments: appointmentFixtures.length, cases: caseFixtures.length };
  store.memoryFaxTable.reset();
  store.setFaxTableForTesting(null);
  resetMockCrematoryMailboxes();
  connectMockCrematoryMailbox(ORG, MAILBOX, 'access-token');
  faxFlags.sending = true;
  faxFlags.maxAttachmentBytes = null;
});
afterEach(() => {
  caseFixtures.length = lengths.cases;
  added.length = 0;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  appointmentFixtures.length = lengths.appointments;
  blobs.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const eventsOf = (type: string, caseId?: string) => activityEventFixtures.slice(lengths.activity).filter((e) => e.eventType === type && (caseId === undefined || e.caseId === caseId));
const bundleRow = (id: string) => store.memoryFaxTable.rows('faxBundles').find((r) => r.beaconFaxBundleId === id)!;
const claims = () => store.memoryFaxTable.rows('faxBundleCases').filter((r) => r.kind === 'claim');
const sendErr = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as FaxBundleError);

// ---------------------------------------------------------------- tests

describe('one bundle = one PDF = one email = one fax, for 1 to 5+ applications', () => {
  it.each([1, 2, 3, 4, 5])('%i application(s): one PDF numbered 1 of N … N of N, sent as exactly one email with exactly one attachment', async (count) => {
    const ids = await casesWithApplications(count);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    expect(preview).toMatchObject({ state: 'ready', applicationCount: count, pageCount: count, destinationFax: '941-554-5490', destinationAddress: GATEWAY });
    expect(preview.subject).toMatch(/^Manors Cremation - DC Application Bundle DC-[2-9A-HJKMNP-TV-Z]{6}$/);

    const stored = blobs.get(bundleRow(preview.id).pdfStorageKey as string)!.buffer;
    for (let n = 1; n <= count; n++) expect(await requestNumbers(stored, n)).toEqual([String(n), String(count)]);

    const graph = fakeGraph();
    const result = await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(result).toMatchObject({ duplicate: false, recorded: true, bundle: { state: 'submitted', stateLabel: 'Submitted to NuSo', senderAddress: MAILBOX } });
    expect(graph.emails()).toHaveLength(1);
    expect(graph.sends()).toHaveLength(1);
    expect(graph.emails()[0].body).toMatchObject({
      subject: preview.subject,
      body: { contentType: 'Text', content: '' },
      toRecipients: [{ emailAddress: { address: GATEWAY } }],
      ccRecipients: [],
    });
    // Nothing about the decedents in the email itself.
    expect(JSON.stringify(graph.emails()[0].body)).not.toMatch(/TESTCASE|Testcase|B2026-9/i);
    const [attachment, ...more] = graph.attachments();
    expect(more).toHaveLength(0);
    expect(attachment).toMatchObject({ name: `${preview.reference}.pdf`, contentType: 'application/pdf' });
    // The transmitted bytes are exactly the previewed, stored PDF.
    expect(sha256(Buffer.from(attachment.contentBytes, 'base64'))).toBe(sha256(stored));
    // Attachment only: nothing in the body (no message, no signature), no CC/BCC,
    // and the PDF has exactly one page per application page — nothing else to fax.
    expect(Object.keys(graph.emails()[0].body as object).sort()).toEqual(['body', 'ccRecipients', 'subject', 'toRecipients']);
    expect((await PDFDocument.load(Buffer.from(attachment.contentBytes, 'base64'))).getPageCount()).toBe(count);
    expect(result.bundle.pageCount).toBe(count);
    expect(sha256(stored)).toBe(bundleRow(preview.id).pdfChecksumSha256);
  });

  it('20 applications fit in one bundle; 21 are refused, nothing stored', async () => {
    const ids = await casesWithApplications(21);
    const twenty = await service.previewFaxBundle(ctx(), ids.slice(0, 20), 'mock');
    expect(twenty).toMatchObject({ applicationCount: 20, pageCount: 20 });
    expect(await requestNumbers(blobs.get(bundleRow(twenty.id).pdfStorageKey as string)!.buffer, 20)).toEqual(['20', '20']);
    const before = store.memoryFaxTable.rows('faxBundles').length;
    expect(await sendErr(service.previewFaxBundle(ctx(), ids, 'mock'))).toMatchObject({ status: 400, message: 'A bundle can hold at most 20 applications.' });
    expect(store.memoryFaxTable.rows('faxBundles')).toHaveLength(before);
  }, 30_000);

  it('keeps the order staff chose — pages and numbers follow it', async () => {
    const [a, b, c] = await casesWithApplications(3);
    const preview = await service.previewFaxBundle(ctx(), [c, a, b], 'mock');
    expect(preview.items.map((i) => [i.position, i.caseId])).toEqual([[1, c], [2, a], [3, b]]);
    const stored = blobs.get(bundleRow(preview.id).pdfStorageKey as string)!.buffer;
    expect([await firstNameOnPage(stored, 1), await firstNameOnPage(stored, 2), await firstNameOnPage(stored, 3)].map((s) => s?.toUpperCase())).toEqual(['CHARLIE', 'ALPHA', 'BRAVO']);
    expect(await requestNumbers(stored, 1)).toEqual(['1', '3']);
  });

  it('refuses a case selected twice, an empty selection, and anything that is not a list', async () => {
    const [a] = await casesWithApplications(1);
    expect(await sendErr(service.previewFaxBundle(ctx(), [a, a], 'mock'))).toMatchObject({ status: 400, message: expect.stringContaining('selected twice') });
    expect(await sendErr(service.previewFaxBundle(ctx(), [], 'mock'))).toMatchObject({ status: 400 });
    expect(await sendErr(service.previewFaxBundle(ctx(), 'fx-case-1', 'mock'))).toMatchObject({ status: 400 });
  });

  it('a multi-page application keeps all its pages, with "Request n of N · page k of m" on its later pages', async () => {
    const [a, b] = await casesWithApplications(2);
    const twoPages = await PDFDocument.load(await applicationPdf('Bravo'));
    twoPages.addPage([612, 792]).drawText('Bravo continuation sheet', { x: 72, y: 700, size: 12 });
    saveApplication(b, await twoPages.save(), 2);
    const preview = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    expect(preview).toMatchObject({ applicationCount: 2, pageCount: 3 });
    const stored = blobs.get(bundleRow(preview.id).pdfStorageKey as string)!.buffer;
    expect(await requestNumbers(stored, 1)).toEqual(['1', '2']);
    expect(await requestNumbers(stored, 2)).toEqual(['2', '2']);
    const page3 = (await textItems(stored, 3)).map((i) => i.str).join(' ');
    expect(page3).toContain('Request 2 of 2 · page 2 of 2');
    expect(page3).toContain('Bravo continuation sheet');
    // Sent: one PDF page per application page — 3 pages, nothing added.
    const graph = fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    const [attachment] = graph.attachments();
    expect((await PDFDocument.load(Buffer.from(attachment.contentBytes, 'base64'))).getPageCount()).toBe(3);
    expect(graph.emails()[0].body).toMatchObject({ body: { contentType: 'Text', content: '' } });
  });
});

describe('numbering in the form\'s own Request boxes — never anything else', () => {
  it('numbers typed on a saved application are replaced in the bundle copy only; the saved original is unchanged', async () => {
    const id = addCase(1);
    const original = await applicationPdf('Alpha', ['7', '9']);
    const document = saveApplication(id, original);
    expect(await requestNumbers(original, 1)).toEqual(['7', '9']);
    const preview = await service.previewFaxBundle(ctx(), [id], 'mock');
    expect(preview.items[0].numbering).toBe('replaced_existing');
    const stored = blobs.get(bundleRow(preview.id).pdfStorageKey as string)!.buffer;
    expect(await requestNumbers(stored, 1)).toEqual(['1', '1']);
    expect((await textItems(stored, 1)).map((i) => i.str)).not.toEqual(expect.arrayContaining(['7', '9']));
    // The saved application itself is byte-for-byte what was saved.
    expect(sha256(blobs.get(document.storageKey)!.buffer)).toBe(document.checksumSha256);
  });

  it('refuses an application whose Request boxes cannot be identified exactly (e.g. not a SOLIS-saved application) — nothing stored', async () => {
    const [a] = await casesWithApplications(1);
    const b = addCase(2);
    const plain = await PDFDocument.create();
    plain.addPage([612, 792]).drawText('Some other PDF', { x: 72, y: 700, size: 12 });
    saveApplication(b, await plain.save());
    const error = await sendErr(service.previewFaxBundle(ctx(), [a, b], 'mock'));
    expect(error).toMatchObject({ status: 422, caseProblems: [{ caseId: b, reason: expect.stringMatching(/"Request ___ of ___" boxes could not be/) }] });
    expect(store.memoryFaxTable.rows('faxBundles')).toHaveLength(0);
  });

  it('a case without a saved application, an archived case and a case from another home are each refused with a reason', async () => {
    const [a] = await casesWithApplications(1);
    const none = addCase(2);
    const archived = addCase(3, { isDeleted: true });
    saveApplication(archived, await applicationPdf('Charlie'));
    const error = await sendErr(service.previewFaxBundle(ctx(), [a, none, archived, '1042-other-org'], 'mock'));
    expect(error?.status).toBe(422);
    expect(error?.caseProblems).toEqual([
      { caseId: none, reason: expect.stringContaining('No saved Manatee County application') },
      { caseId: archived, reason: 'This case is archived.' },
      { caseId: '1042-other-org', reason: 'Case not found.' },
    ]);
  });

  it('the bundle size is checked against the configured limit', async () => {
    const ids = await casesWithApplications(2);
    faxFlags.maxAttachmentBytes = 10_000;
    expect(await sendErr(service.previewFaxBundle(ctx(), ids, 'mock'))).toMatchObject({ status: 413, message: expect.stringContaining('the limit is') });
  });
});

describe('Send Fax safeguards', () => {
  it('sending stays off until it is turned on: nothing is contacted', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    faxFlags.sending = false;
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('not active yet') });
    expect(graph.calls).toHaveLength(0);
    expect(bundleRow(preview.id).status).toBe('ready');
  });

  it('a double click (two simultaneous requests, same submission) sends exactly one fax; repeating it later sends nothing', async () => {
    const ids = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const graph = fakeGraph();
    const results = await Promise.allSettled([service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'), service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock')]);
    expect(graph.sends()).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).not.toHaveLength(0);
    const again = await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(again).toMatchObject({ duplicate: true });
    expect(graph.sends()).toHaveLength(1);
    // A new request id for the same bundle is refused, not resent.
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0002', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('already sent') });
    expect(graph.sends()).toHaveLength(1);
  });

  it('two bundles sharing a case, sent at the same time: exactly one fax goes; the other sends nothing and frees its cases', async () => {
    const [a, b, c] = await casesWithApplications(3);
    const first = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    const second = await service.previewFaxBundle(ctx(), [b, c], 'mock');
    const graph = fakeGraph();
    const results = await Promise.allSettled([service.sendFaxBundle(ctx(), first.id, 'submission-000A', 'mock'), service.sendFaxBundle(ctx(), second.id, 'submission-000B', 'mock')]);
    expect(graph.sends()).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409, message: expect.stringContaining('Nothing was sent') });
    const loser = bundleRow(first.id).status === 'submitted' ? second : first;
    expect(bundleRow(loser.id)).toMatchObject({ status: 'ready', outlookContactedAt: null });
    // Only the winning bundle's cases are held.
    const winner = loser === first ? second : first;
    expect(claims().map((r) => r.caseId).sort()).toEqual([...bundleRow(winner.id).caseIds as string[]].sort());
  });

  it('an Outlook failure that cannot have sent: nothing sent, cases released, and Send Fax can be pressed again', async () => {
    const ids = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    fakeGraph({ createStatus: 403 });
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 502, message: expect.stringContaining('Nothing was sent') });
    expect(bundleRow(preview.id)).toMatchObject({ status: 'ready', failureCode: 'outlook_not_sent', submissionId: null });
    expect(claims()).toHaveLength(0);
    expect(eventsOf('fax_bundle.send_failed')).toHaveLength(1);
    const graph = fakeGraph();
    await expect(service.sendFaxBundle(ctx(), preview.id, 'submission-0002', 'mock')).resolves.toMatchObject({ bundle: { state: 'submitted' } });
    expect(graph.sends()).toHaveLength(1);
  });

  it.each([
    ['Outlook says it may have sent (5xx on send)', { sendStatus: 503 }],
    ['the connection drops during the send call', { sendThrows: true }],
  ])('%s: the bundle needs review, its cases stay held, and it is never sent again automatically', async (_label, behaviour) => {
    const [a, b] = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    fakeGraph(behaviour);
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 502, message: expect.stringContaining('may still have been sent') });
    expect(bundleRow(preview.id).status).toBe('needs_review');
    expect(claims().map((r) => r.caseId).sort()).toEqual([a, b].sort());
    expect(eventsOf('fax_bundle.needs_review')).toHaveLength(2);

    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('never sent again automatically') });
    expect(await sendErr(service.previewFaxBundle(ctx(), [a], 'mock'))).toMatchObject({ status: 422, caseProblems: [{ caseId: a, reason: expect.stringContaining('may have been faxed') }] });
    expect(graph.calls).toHaveLength(0);
    const eligible = await service.listFaxEligibleCases(ORG, 'mock');
    expect(eligible.cases.find((c) => c.caseId === a)).toMatchObject({ available: false, reason: expect.stringContaining('may have been faxed') });
  });

  it('if the attempt cannot be recorded before contacting Outlook, nothing is sent and the cases are released', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const failing = { ...store.memoryFaxTable, patchIf: async (c: string, id: string, fields: Record<string, unknown>, cond: Record<string, unknown>) => ('outlookContactedAt' in fields && fields.outlookContactedAt ? Promise.reject(new Error('Wix 503')) : store.memoryFaxTable.patchIf(c, id, fields, cond)) };
    store.setFaxTableForTesting(failing);
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 503, message: expect.stringContaining('Nothing was sent') });
    expect(graph.calls).toHaveLength(0);
    expect(bundleRow(preview.id).status).toBe('ready');
    expect(claims()).toHaveLength(0);
  });

  it('if holding a case fails, nothing is sent and the cases held so far are released', async () => {
    const ids = await casesWithApplications(3);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    let inserts = 0;
    const failing = { ...store.memoryFaxTable, insert: async (c: string, id: string, data: Record<string, unknown>) => (data.kind === 'claim' && ++inserts === 2 ? Promise.reject(new Error('Wix 503')) : store.memoryFaxTable.insert(c, id, data)) };
    store.setFaxTableForTesting(failing);
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 503 });
    expect(graph.calls).toHaveLength(0);
    expect(claims()).toHaveLength(0);
    expect(bundleRow(preview.id).status).toBe('ready');
  });

  it('Outlook accepted it but SOLIS could not record that: the bundle reads as needing review (never resent) and can be resolved', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const failing = { ...store.memoryFaxTable, patchIf: async (c: string, id: string, fields: Record<string, unknown>, cond: Record<string, unknown>) => (fields.status === 'submitted' ? 'conflict' as const : store.memoryFaxTable.patchIf(c, id, fields, cond)) };
    store.setFaxTableForTesting(failing);
    const graph = fakeGraph();
    const result = await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(result).toMatchObject({ recorded: false });
    expect(graph.sends()).toHaveLength(1);
    store.setFaxTableForTesting(null);
    expect(eventsOf('fax_bundle.submitted')[0]).toMatchObject({ severity: 'warning' });

    // Within the first minutes it reads as "sending"; after that, as needing review — never as sendable.
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0002', 'mock'))).toMatchObject({ status: 409 });
    vi.useFakeTimers({ now: Date.now() + 6 * 60 * 1000, toFake: ['Date'] });
    expect((await service.getFaxBundleView(ORG, preview.id, 'mock')).state).toBe('needs_review');
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0003', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('never sent again automatically') });
    expect(graph.sends()).toHaveLength(1);
    await expect(service.recordFaxBundleOutcome(ctx('manager'), preview.id, { decision: 'delivered' }, 'mock')).resolves.toMatchObject({ bundle: { state: 'delivered' } });
  });

  it('a send abandoned before Outlook was contacted releases its cases after a few minutes — nothing can have been sent', async () => {
    const [a, b] = await casesWithApplications(2);
    const first = await service.previewFaxBundle(ctx(), [a], 'mock');
    // Simulate a server that stopped right after holding the case.
    const row = bundleRow(first.id);
    await store.memoryFaxTable.patchIf('faxBundles', first.id, { status: 'sending', submissionId: 'submission-dead', updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(), revision: (row.revision as number) + 1 }, {});
    await store.claimCaseForFaxBundle(ORG, a, first.id, 'mock');
    const second = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    const graph = fakeGraph();
    await expect(service.sendFaxBundle(ctx(), second.id, 'submission-0001', 'mock')).resolves.toMatchObject({ bundle: { state: 'submitted' } });
    expect(graph.sends()).toHaveLength(1);
    expect(bundleRow(first.id)).toMatchObject({ status: 'ready' });
  });

  it('a hold left behind by a failed release (nothing was sent under it) never blocks a later fax', async () => {
    const [a, b] = await casesWithApplications(2);
    const first = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    // Outlook refuses before anything is sent, and releasing the holds fails (Wix briefly down).
    fakeGraph({ createStatus: 403 });
    const failingRemove = { ...store.memoryFaxTable, remove: async () => Promise.reject(new Error('Wix 503')) };
    store.setFaxTableForTesting(failingRemove);
    expect(await sendErr(service.sendFaxBundle(ctx(), first.id, 'submission-0001', 'mock'))).toMatchObject({ status: 502, message: expect.stringContaining('Nothing was sent') });
    store.setFaxTableForTesting(null);
    expect(bundleRow(first.id).status).toBe('ready');
    expect(claims().map((r) => r.bundleId)).toEqual([first.id, first.id]);
    // A new bundle with those cases sends; the stale holds are cleared, one fax goes.
    const second = await service.previewFaxBundle(ctx(), [b, a], 'mock');
    const graph = fakeGraph();
    await expect(service.sendFaxBundle(ctx(), second.id, 'submission-0002', 'mock')).resolves.toMatchObject({ bundle: { state: 'submitted' } });
    expect(graph.sends()).toHaveLength(1);
    expect(claims().every((r) => r.bundleId === second.id)).toBe(true);
  });

  it('a genuine hold (a bundle submitted, delivered or needing review) is never cleared', async () => {
    const [a, b] = await casesWithApplications(2);
    const first = await service.previewFaxBundle(ctx(), [a], 'mock');
    fakeGraph({ sendStatus: 503 });
    await sendErr(service.sendFaxBundle(ctx(), first.id, 'submission-0001', 'mock'));
    expect(bundleRow(first.id).status).toBe('needs_review');
    // Built before the hold existed (a stale preview), then sent: refused, nothing sent.
    store.memoryFaxTable.reset();
    const preview = await service.previewFaxBundle(ctx(), [a, b], 'mock');
    await store.memoryFaxTable.insert('faxBundles', first.id, { ...(await store.getFaxBundle(ORG, first.id, 'mock')), beaconFaxBundleId: first.id, organizationId: ORG, status: 'needs_review', revision: 9, history: [], items: [], caseIds: [a], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await store.claimCaseForFaxBundle(ORG, a, first.id, 'mock');
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0002', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('may have been faxed') });
    expect(graph.calls).toHaveLength(0);
    expect((await store.getFaxCaseClaim(ORG, a, 'mock'))?.bundleId).toBe(first.id);
    expect(await store.getFaxCaseClaim(ORG, b, 'mock')).toBeNull();
  });

  it('an application saved again after the preview stops the send — preview again; nothing sent', async () => {
    const [a] = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), [a], 'mock');
    saveApplication(a, await applicationPdf('Alpha-two'), 2);
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('changed since the preview') });
    expect(graph.calls).toHaveLength(0);
  });

  it('a stored bundle PDF that no longer matches its checksum is never sent', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    blobs.set(bundleRow(preview.id).pdfStorageKey as string, { buffer: Buffer.from('%PDF-tampered'), contentType: 'application/pdf' });
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 503 });
    expect(graph.calls).toHaveLength(0);
  });

  it('a preview more than a day old is discarded (its PDF deleted) and must be made again', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const key = bundleRow(preview.id).pdfStorageKey as string;
    vi.useFakeTimers({ now: Date.now() + 25 * 60 * 60 * 1000, toFake: ['Date'] });
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('more than a day old') });
    expect(bundleRow(preview.id).status).toBe('discarded');
    expect(blobs.has(key)).toBe(false);
    expect(graph.calls).toHaveLength(0);
  });

  it('a submitted bundle keeps its exact PDF and full history', async () => {
    const ids = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    const row = bundleRow(preview.id);
    expect(blobs.has(row.pdfStorageKey as string)).toBe(true);
    expect((row.history as Array<{ action: string }>).map((h) => h.action)).toEqual(['previewed', 'send_started', 'outlook_contacted', 'submitted']);
    expect(row).toMatchObject({ senderAddress: MAILBOX, sentBy: 'staff-dana', submissionId: 'submission-0001', internetMessageId: '<msg-1@example>' });
  });
});

describe('recording delivery', () => {
  async function sentBundle(count = 2) {
    const ids = await casesWithApplications(count);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    return { ids, preview };
  }

  it('only members with fax.confirm may record it: Arranger, Accounting, Read Only and Dispatch cannot (the service checks, not just the route)', async () => {
    const { preview } = await sentBundle();
    for (const role of ['arranger', 'accounting', 'readOnly', 'dispatch', 'no-such-role']) {
      expect(await sendErr(service.recordFaxBundleOutcome(ctx(role), preview.id, { decision: 'delivered' }, 'mock')), role).toMatchObject({ status: 403 });
    }
    expect(await sendErr(service.recordFaxBundleOutcome({ ...ctx(), actorIdentityId: null as unknown as string }, preview.id, { decision: 'delivered' }, 'mock'))).toMatchObject({ status: 403 });
    expect(bundleRow(preview.id).status).toBe('submitted');
  });

  it.each(['administrator', 'manager', 'funeralDirector', 'officeStaff'])('%s may record the result', async (role) => {
    const { preview } = await sentBundle(1);
    await expect(service.recordFaxBundleOutcome(ctx(role), preview.id, { decision: 'delivered' }, 'mock')).resolves.toMatchObject({ bundle: { state: 'delivered' } });
  });

  it('delivered: completes "Sent day before ashes arrive" with the actual date — not the target day — and the cases can never be faxed again', async () => {
    const { ids, preview } = await sentBundle();
    expectedPickup(ids[0], '2026-11-10');
    const deliveredAt = new Date(Date.now() - 60_000).toISOString();
    const result = await service.recordFaxBundleOutcome(ctx('manager', 'staff-morgan'), preview.id, { decision: 'delivered', deliveredAt, nusoReference: 'NS-12345' }, 'mock');
    expect(result.bundle).toMatchObject({ state: 'delivered', stateLabel: 'Confirmed Delivered', deliveredAt, nusoReference: 'NS-12345' });
    for (const id of ids) {
      const c = caseFixtures.find((x) => x.id === id)!;
      expect(c.checklistState?.['4:1']).toBe(true);
      expect(c.checklistCompletions?.['4:1']).toMatchObject({ method: 'automatic', eventType: 'fax.dc_application_delivered', eventId: preview.id, actorId: 'staff-morgan' });
      expect(c.checklistState?.['4:0']).toBeUndefined();
    }
    const [event] = eventsOf('fax_bundle.delivered', ids[0]);
    expect(event.description).toContain(`application 1 of 2`);
    expect(event.description).toContain('target day was Nov 9, 2026');
    expect(JSON.parse(event.newValue as string)).toMatchObject({ deliveredAt, targetDate: '2026-11-09' });
    expect(claims().map((r) => r.caseId).sort()).toEqual([...ids].sort());
    expect(await sendErr(service.previewFaxBundle(ctx(), [ids[0]], 'mock'))).toMatchObject({ status: 422, caseProblems: [{ reason: expect.stringContaining('Already faxed and delivered') }] });
    expect((await service.listFaxEligibleCases(ORG, 'mock')).cases.map((c) => c.caseId)).not.toContain(ids[0]);
    expect(await sendErr(service.recordFaxBundleOutcome(ctx('manager'), preview.id, { decision: 'failed' }, 'mock'))).toMatchObject({ status: 409 });
  });

  it('a delivery time in the future or before the fax was sent is refused', async () => {
    const { preview } = await sentBundle(1);
    expect(await sendErr(service.recordFaxBundleOutcome(ctx(), preview.id, { decision: 'delivered', deliveredAt: new Date(Date.now() + 3_600_000).toISOString() }, 'mock'))).toMatchObject({ status: 400 });
    expect(await sendErr(service.recordFaxBundleOutcome(ctx(), preview.id, { decision: 'delivered', deliveredAt: '2020-01-01T00:00:00.000Z' }, 'mock'))).toMatchObject({ status: 400 });
  });

  it('failed: the cases are released and can go in a new bundle; nothing is checked', async () => {
    const { ids, preview } = await sentBundle();
    await service.recordFaxBundleOutcome(ctx('manager'), preview.id, { decision: 'failed', note: 'NuSo reported a busy line' }, 'mock');
    expect(bundleRow(preview.id)).toMatchObject({ status: 'failed', failureCode: 'not_delivered', failureMessage: 'NuSo reported a busy line' });
    expect(claims()).toHaveLength(0);
    expect(caseFixtures.find((x) => x.id === ids[0])!.checklistState?.['4:1']).toBeUndefined();
    await expect(service.previewFaxBundle(ctx(), ids, 'mock')).resolves.toMatchObject({ state: 'ready' });
  });

  it('a confirmation file is kept privately with the bundle', async () => {
    const { preview } = await sentBundle(1);
    const bytes = new TextEncoder().encode('From: fax@nuso.example\nSubject: Fax delivered\n\nDelivered.');
    await service.recordFaxBundleOutcome(ctx(), preview.id, { decision: 'delivered', confirmation: { fileName: 'nuso.eml', mimeType: 'message/rfc822', bytes } }, 'mock');
    const key = bundleRow(preview.id).confirmationDocumentId as string;
    expect(key).toMatch(new RegExp(`^${ORG}/fax-bundles/${preview.id}-confirmation-.+\\.eml$`));
    expect(blobs.get(key)!.buffer.toString()).toContain('Fax delivered');
    expect(await sendErr(service.recordFaxBundleOutcome(ctx(), preview.id, { decision: 'delivered', confirmation: { fileName: 'x.exe', mimeType: 'application/x-msdownload', bytes } }, 'mock'))).toMatchObject({ status: 400 });
  });

  it('two people recording at once: one wins, the other is told it changed', async () => {
    const { preview } = await sentBundle(1);
    const results = await Promise.allSettled([
      service.recordFaxBundleOutcome(ctx('manager'), preview.id, { decision: 'delivered' }, 'mock'),
      service.recordFaxBundleOutcome(ctx('administrator'), preview.id, { decision: 'failed' }, 'mock'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
  });
});

describe('case history, eligibility and organization isolation', () => {
  it('each case shows the bundle it was in and its place in it', async () => {
    const ids = await casesWithApplications(3);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(await service.listCaseFaxHistory(ORG, ids[1], 'mock')).toEqual([expect.objectContaining({ bundleId: preview.id, reference: preview.reference, position: 2, applicationCount: 3, state: 'submitted' })]);
    expect(eventsOf('fax_bundle.submitted').map((e) => e.caseId)).toEqual(ids);
    expect(eventsOf('fax_bundle.previewed')).toHaveLength(1);
  });

  it('lists only selectable applications, with the target day before the Expected Pickup; cases already marked sent by staff are left out', async () => {
    const [a, b] = await casesWithApplications(2);
    expectedPickup(a, '2026-11-12');
    caseFixtures.find((c) => c.id === b)!.checklistState = { '4:1': true };
    const list = await service.listFaxEligibleCases(ORG, 'mock');
    expect(list).toMatchObject({ destinationName: 'Manatee County Vital Statistics', destinationFax: '941-554-5490', sendingEnabled: true, maxApplications: 20 });
    expect(list.cases.map((c) => c.caseId)).toContain(a);
    expect(list.cases.map((c) => c.caseId)).not.toContain(b);
    expect(list.cases.find((c) => c.caseId === a)).toMatchObject({ available: true, expectedPickupDate: '2026-11-12', targetDate: '2026-11-11' });
  });

  it('another organization never sees, reads or sends a bundle; Gus has no fax bundles at all', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const other = { ...ctx(), organizationId: 'evergreen-memorial-group' };
    expect(await sendErr(service.getFaxBundleView('evergreen-memorial-group', preview.id, 'mock'))).toMatchObject({ status: 404 });
    expect(await sendErr(service.sendFaxBundle(other, preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 404 });
    expect(await sendErr(service.getFaxBundleView(GUS_ORGANIZATION_ID, preview.id, 'mock'))).toMatchObject({ status: 404, message: expect.stringContaining('not set up') });
    expect(store.faxClaimId(ORG, ids[0])).not.toBe(store.faxClaimId('evergreen-memorial-group', ids[0]));
  });

  it('every stored row id stays within Wix\'s 128-character limit', async () => {
    const ids = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    const rowIds = [...store.memoryFaxTable.rows('faxBundles').map((r) => r.beaconFaxBundleId), ...store.memoryFaxTable.rows('faxBundleCases').map((r) => r.beaconFaxBundleCaseId)] as string[];
    expect(rowIds.length).toBeGreaterThan(3);
    for (const id of rowIds) expect(id.length).toBeLessThanOrEqual(128);
  });
});

// ---------------------------------------------------------------- Fax Settings (2026-11)

describe('Fax Settings: a prepared bundle keeps what it was previewed with', () => {
  const settings = () => import('../faxSettings/faxSettingsService');

  it('the preview uses the default destination and subject from Fax Settings, and keeps them on the bundle', async () => {
    const fs = await settings();
    let overview = await fs.createFaxDestination(ctx(), { name: 'Sarasota County Records', faxNumber: '941-555-0177', makeDefault: true }, 'mock');
    overview = await fs.updateFaxSettings(ctx(), { expectedRevision: overview.settings.revision, subjectTemplate: 'DC applications {reference} ({applicationCount})' }, 'mock');
    const ids = await casesWithApplications(2);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const destinationId = overview.destinations.find((d) => d.isDefault)!.id;
    expect(preview).toMatchObject({ destinationName: 'Sarasota County Records', destinationAddress: '9415550177@fax.nuso.io', subject: `DC applications ${preview.reference} (2)` });
    expect(bundleRow(preview.id)).toMatchObject({ destinationId, providerKey: 'nuso', emailBody: '', settingsRevision: overview.settings.revision });

    const graph = fakeGraph();
    await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(graph.emails()[0].body).toMatchObject({ subject: preview.subject, body: { contentType: 'Text', content: '' }, toRecipients: [{ emailAddress: { address: '9415550177@fax.nuso.io' } }] });
    const rowIds = [...store.memoryFaxTable.rows('faxDestinations').map((r) => r.beaconFaxDestinationId), ...store.memoryFaxTable.rows('faxSettings').map((r) => r.beaconFaxSettingsId)] as string[];
    for (const id of rowIds) expect(id.length).toBeLessThanOrEqual(128);
  });

  it('the destination\'s number changes after the preview: the bundle is never redirected — nothing is sent, nothing held; preview again', async () => {
    const fs = await settings();
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const before = structuredClone(bundleRow(preview.id));
    await fs.updateFaxDestination(ctx(), 'builtin', { faxNumber: '941-555-0100' }, 'mock');
    // The prepared bundle itself is untouched.
    expect(bundleRow(preview.id)).toEqual(before);
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringMatching(/fax destination changed since the preview.*Nothing was sent/) });
    expect(graph.calls).toHaveLength(0);
    expect(claims()).toHaveLength(0);
    expect(bundleRow(preview.id).status).toBe('ready');
    // A new preview goes to the new number.
    const again = await service.previewFaxBundle(ctx(), ids, 'mock');
    expect(again.destinationAddress).toBe('9415550100@fax.nuso.io');
  });

  it('another destination becomes the default after the preview: nothing is sent', async () => {
    const fs = await settings();
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    await fs.createFaxDestination(ctx(), { name: 'Elsewhere', faxNumber: '305-555-0100', makeDefault: true }, 'mock');
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('fax destination changed since the preview') });
    expect(graph.calls).toHaveLength(0);
  });

  it('the subject template changes after the preview: nothing is sent', async () => {
    const fs = await settings();
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    await fs.updateFaxSettings(ctx(), { expectedRevision: null, subjectTemplate: 'New subject {reference}' }, 'mock');
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('fax email settings changed since the preview') });
    expect(graph.calls).toHaveLength(0);
  });

  it('a change that does not affect the email (the destination\'s name) leaves the prepared bundle sendable, exactly as previewed', async () => {
    const fs = await settings();
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    await fs.updateFaxDestination(ctx(), 'builtin', { name: 'Manatee County Health Dept. — Vital Statistics' }, 'mock');
    const graph = fakeGraph();
    const result = await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(result.bundle).toMatchObject({ state: 'submitted', destinationName: 'Manatee County Vital Statistics' });
    expect(graph.emails()[0].body).toMatchObject({ subject: preview.subject, toRecipients: [{ emailAddress: { address: GATEWAY } }] });
  });

  it('the default destination is archived by a race: nothing can be prepared, nothing is sent', async () => {
    const fs = await settings();
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const overview = await fs.updateFaxDestination(ctx(), 'builtin', { name: 'Kept' }, 'mock');
    const d = overview.destinations[0];
    await store.memoryFaxTable.patchIf('faxDestinations', d.id, { status: 'archived' }, { revision: d.revision });
    const graph = fakeGraph();
    expect(await sendErr(service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock'))).toMatchObject({ status: 409, message: expect.stringContaining('no longer available') });
    expect(await sendErr(service.previewFaxBundle(ctx(), ids, 'mock'))).toMatchObject({ status: 409 });
    expect(graph.calls).toHaveLength(0);
  });

  it('a bundle prepared before Fax Settings existed (no snapshot fields) still sends exactly as it was previewed', async () => {
    const ids = await casesWithApplications(1);
    const preview = await service.previewFaxBundle(ctx(), ids, 'mock');
    const row = bundleRow(preview.id);
    for (const key of ['destinationId', 'providerKey', 'emailBody', 'settingsRevision']) delete row[key];
    await store.memoryFaxTable.remove('faxBundles', preview.id);
    await store.memoryFaxTable.insert('faxBundles', preview.id, row);
    const graph = fakeGraph();
    const result = await service.sendFaxBundle(ctx(), preview.id, 'submission-0001', 'mock');
    expect(result.bundle.state).toBe('submitted');
    expect(graph.emails()[0].body).toMatchObject({ subject: preview.subject, body: { contentType: 'Text', content: '' }, toRecipients: [{ emailAddress: { address: GATEWAY } }] });
  });
});
