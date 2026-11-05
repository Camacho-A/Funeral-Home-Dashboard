// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join } from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * Fax test transmissions (2026-11), mock mode. Fictional recipients only
 * (555-01xx numbers, example.test addresses) and a simulated Microsoft
 * Graph: nothing leaves the test. Manors' real profile has an EMPTY
 * allowlist; the tests that need recipients add them through this mock.
 */
const OTHER = 'zz-other-fax-home';
const recipients = vi.hoisted(() => ({ value: { faxNumbers: ['305-555-0101'], emailAddresses: ['dry-run@example.test'] } as { faxNumbers: string[]; emailAddresses: string[] } | null }));
vi.mock('@/domain/faxBundles/faxSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/faxBundles/faxSettings')>();
  return {
    ...actual,
    deathCertificateFaxSettings: (organizationId: string | null | undefined) => {
      if (organizationId === OTHER) return { destinationName: 'Other County Records', faxNumber: '3055550123', gatewayDomain: 'fax.nuso.io', emailOrganizationName: 'Other Home', maxAttachmentBytes: 1_000_000, sendingEnabled: false, testRecipients: { faxNumbers: ['305-555-0199'], emailAddresses: ['other@example.test'] } };
      const real = actual.deathCertificateFaxSettings(organizationId);
      return real && recipients.value ? { ...real, testRecipients: recipients.value } : real;
    },
  };
});

const service = await import('./faxTestService');
const { memoryFaxTable, setFaxTableForTesting } = await import('../faxBundles/faxBundleStore');
const { activityEventFixtures } = await import('../__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } = await import('../__mocks__/organizationIds');
const { connectMockCrematoryMailbox, resetMockCrematoryMailboxes } = await import('../crematory/crematoryMailboxService');
const faxBundles = await import('../faxBundles/faxBundleService');
const { buildFaxTestPdf } = await import('./faxTestPdf');
type TestError = InstanceType<typeof service.FaxTestError>;

const ORG = DEFAULT_ORGANIZATION_ID;
const ctx = (role = 'administrator', organizationId = ORG, actor = 'identity-admin') => ({ organizationId, actorIdentityId: actor, actorMembershipId: null, actorRoleKey: role, correlationId: 'corr' });
const err = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as TestError);
const FAX = { key: 'fax:3055550101', display: '305-555-0101', address: '3055550101@fax.nuso.io' };
const MAIL = { key: 'email:dry-run@example.test', display: 'dry-run@example.test', address: 'dry-run@example.test' };
let n = 0;
const sid = () => `submission-${String(++n).padStart(4, '0')}`;
const request = (step: 0 | 1 | 2, r = step === 0 ? MAIL : FAX, overrides: Record<string, unknown> = {}) => ({
  step,
  recipientKey: r.key,
  submissionId: sid(),
  confirm: { acknowledged: true, recipient: r.display, pages: step === 2 ? 2 : 1 },
  ...overrides,
});

// ---------------------------------------------------------------- simulated Graph
type GraphCall = { method: string; path: string; body: unknown; at: number };
let order = 0;
function fakeGraph(behaviour: { createStatus?: number; sendStatus?: number; sendThrows?: boolean; onSend?: () => void } = {}) {
  const calls: GraphCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://graph.microsoft.com/v1.0', '');
    calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, at: ++order });
    if (path === '/me/messages' && init?.method === 'POST') {
      if (behaviour.createStatus) return new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: behaviour.createStatus });
      return new Response(JSON.stringify({ id: `draft-${calls.length}`, internetMessageId: `<test-${calls.length}@example>` }), { status: 201 });
    }
    if (path.endsWith('/attachments') && init?.method === 'POST') return new Response('{}', { status: 201 });
    if (path.endsWith('/send')) {
      behaviour.onSend?.();
      if (behaviour.sendThrows) throw new TypeError('fetch failed');
      return new Response(null, { status: behaviour.sendStatus ?? 202 });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    drafts: () => calls.filter((c) => c.path === '/me/messages' && c.method === 'POST'),
    sends: () => calls.filter((c) => c.path.endsWith('/send')),
    attachments: () => calls.filter((c) => c.path.endsWith('/attachments')).map((c) => c.body as { name: string; contentType: string; contentBytes: string }),
  };
}

let activityLength = 0;
beforeEach(() => {
  memoryFaxTable.reset();
  setFaxTableForTesting(null);
  resetMockCrematoryMailboxes();
  connectMockCrematoryMailbox(ORG, 'office@funeralhome.example', 'access-token');
  connectMockCrematoryMailbox(OTHER, 'office@other.example', 'other-token');
  recipients.value = { faxNumbers: ['305-555-0101'], emailAddresses: ['dry-run@example.test'] };
  activityLength = activityEventFixtures.length;
});
afterEach(() => {
  vi.unstubAllGlobals();
  activityEventFixtures.length = activityLength;
});
const events = () => activityEventFixtures.slice(activityLength);
const testRows = () => memoryFaxTable.rows('faxTestTransmissions');

/** Runs step 0 (and optionally 1) through to a passing delivery. */
async function passStep0() {
  fakeGraph();
  const { transmission } = await service.sendFaxTest(ctx(), request(0), 'mock');
  const checks = Object.fromEntries(Object.keys((await service.getFaxTestOverview(ctx(), 'mock')).dryRunChecks.reduce((a, c) => ({ ...a, [c.key]: true }), {})).map((k) => [k, true]));
  return service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, checks }, 'mock');
}
async function passStep1() {
  await passStep0();
  fakeGraph();
  const { transmission } = await service.sendFaxTest(ctx(), request(1), 'mock');
  return service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, pagesReceived: 1 }, 'mock');
}

describe('off unless recipients are approved in code', () => {
  it('Manors\' real profile has an empty allowlist: the feature is off and sends nothing', async () => {
    recipients.value = null;
    const graph = fakeGraph();
    const overview = await service.getFaxTestOverview(ctx(), 'mock');
    expect(overview).toMatchObject({ enabled: false, recipients: [], sendingEnabled: false });
    expect(overview.steps.every((s) => !s.available)).toBe(true);
    const e = await err(service.sendFaxTest(ctx(), request(0), 'mock'));
    expect(e).toMatchObject({ status: 409, message: expect.stringMatching(/Test transmissions are off.*Nothing was sent/) });
    expect(graph.calls).toHaveLength(0);
    expect(testRows()).toHaveLength(0);
  });

  it('invalid allowlist entries are skipped, never "fixed" into a recipient; a gateway address is not a dry-run address', async () => {
    recipients.value = { faxNumbers: ['555-01', '041-555-0101'], emailAddresses: ['not an email', '3055550101@fax.nuso.io'] };
    const overview = await service.getFaxTestOverview(ctx(), 'mock');
    expect(overview).toMatchObject({ enabled: false, recipients: [], invalidRecipients: 4 });
  });
});

describe('who may run tests, and for which organization', () => {
  it('administrators who may fax only; every other role is refused before anything happens', async () => {
    const graph = fakeGraph();
    for (const role of ['funeral_director', 'office_staff', 'manager', 'read_only', 'arranger', 'accounting', 'dispatch']) {
      expect((await err(service.getFaxTestOverview(ctx(role), 'mock')))?.status).toBe(403);
      expect((await err(service.sendFaxTest(ctx(role), request(0), 'mock')))?.status).toBe(403);
    }
    expect((await err(service.sendFaxTest({ ...ctx(), actorIdentityId: null }, request(0), 'mock')))?.status).toBe(403);
    expect(graph.calls).toHaveLength(0);
  });

  it('an organization that does not fax has no tests (Gus)', async () => {
    expect((await err(service.getFaxTestOverview(ctx('administrator', GUS_ORGANIZATION_ID), 'mock')))?.status).toBe(404);
  });

  it('each organization has its own recipients, tests and lock; another organization\'s recipient or test does not exist for it', async () => {
    fakeGraph();
    const ours = await service.sendFaxTest(ctx(), request(0), 'mock');
    // The other home is not blocked by our open test, and cannot use our recipient.
    expect((await err(service.sendFaxTest(ctx('administrator', OTHER), request(0, MAIL), 'mock')))?.message).toMatch(/not on the approved test list/);
    const theirs = await service.sendFaxTest(ctx('administrator', OTHER), request(0, { key: 'email:other@example.test', display: 'other@example.test', address: '' }), 'mock');
    expect(theirs.transmission.recipientAddress).toBe('other@example.test');
    expect((await err(service.recordFaxTestOutcome(ctx('administrator', OTHER), ours.transmission.id, { status: 'failed', expectedRevision: ours.transmission.revision }, 'mock')))?.status).toBe(404);
    expect((await service.getFaxTestOverview(ctx(), 'mock')).transmissions.map((t) => t.id)).toEqual([ours.transmission.id]);
  });
});

describe('only approved recipients, only after confirmation, only in order', () => {
  it('the browser names a recipient by key; an address it sends is ignored; unknown or wrong-kind keys are refused', async () => {
    const graph = fakeGraph();
    expect((await err(service.sendFaxTest(ctx(), request(0, { ...MAIL, key: 'email:someone@else.test' }), 'mock')))?.status).toBe(400);
    expect((await err(service.sendFaxTest(ctx(), request(0, FAX), 'mock')))?.message).toMatch(/needs an approved dry-run email address/);
    const sent = await service.sendFaxTest(ctx(), request(0, MAIL, { recipientAddress: 'attacker@evil.test', to: ['attacker@evil.test'] }), 'mock');
    expect(graph.drafts().map((d) => (d.body as { toRecipients: unknown }).toRecipients)).toEqual([[{ emailAddress: { address: 'dry-run@example.test' } }]]);
    expect(sent.transmission.recipientAddress).toBe('dry-run@example.test');
  });

  it('each send must repeat exactly what was confirmed — recipient and page count', async () => {
    const graph = fakeGraph();
    for (const confirm of [undefined, {}, { acknowledged: false, recipient: MAIL.display, pages: 1 }, { acknowledged: true, recipient: 'other@example.test', pages: 1 }, { acknowledged: true, recipient: MAIL.display, pages: 2 }]) {
      expect((await err(service.sendFaxTest(ctx(), request(0, MAIL, { confirm }), 'mock')))?.message).toMatch(/Confirm the test first/);
    }
    expect(graph.calls).toHaveLength(0);
    expect(testRows()).toHaveLength(0);
  });

  it('step 1 only after the dry run passed; step 2 only after the one-page fax passed', async () => {
    const graph = fakeGraph();
    expect((await err(service.sendFaxTest(ctx(), request(1), 'mock')))?.message).toMatch(/Step 0 must pass first/);
    expect((await err(service.sendFaxTest(ctx(), request(2), 'mock')))?.message).toMatch(/Step 1 must pass first/);
    expect(graph.calls).toHaveLength(0);
    await passStep1();
    const overview = await service.getFaxTestOverview(ctx(), 'mock');
    expect(overview.steps.map((s) => [s.step, s.passed, s.available])).toEqual([[0, true, true], [1, true, true], [2, false, true]]);
  });

  it('a delivery with the wrong page count does not pass, and does not unlock the next step', async () => {
    await passStep0();
    fakeGraph();
    const { transmission } = await service.sendFaxTest(ctx(), request(1), 'mock');
    const recorded = await service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, pagesReceived: 3, note: 'NuSo added a cover page and a text page' }, 'mock');
    expect(recorded).toMatchObject({ status: 'delivered', pagesReceived: 3, passed: false });
    expect(events().at(-1)?.description).toMatch(/3 page\(s\) received, 1 sent — DID NOT PASS/);
    expect((await err(service.sendFaxTest(ctx(), request(2), 'mock')))?.message).toMatch(/Step 1 must pass first/);
  });
});

describe('exactly the Send Fax email: empty plain-text body, one fictional PDF', () => {
  it('step 0: one draft to the approved address, the real subject template with a TEST- reference, an empty Text body, no cc, ONE attachment — the 1-page test PDF, byte for byte', async () => {
    const graph = fakeGraph();
    const { transmission } = await service.sendFaxTest(ctx(), request(0), 'mock');
    const [draft] = graph.drafts();
    expect(draft.body).toEqual({
      subject: expect.stringMatching(/^Manors Cremation - DC Application Bundle TEST-[A-HJ-NP-Z2-9]{6}$/),
      body: { contentType: 'Text', content: '' },
      toRecipients: [{ emailAddress: { address: 'dry-run@example.test' } }],
      ccRecipients: [],
    });
    const attachments = graph.attachments();
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ name: 'SOLIS-FAX-TEST-1-PAGE.pdf', contentType: 'application/pdf' });
    const bytes = Buffer.from(attachments[0].contentBytes, 'base64');
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    expect(checksum).toBe(transmission.pdfChecksumSha256);
    expect(checksum).toBe((await service.getFaxTestOverview(ctx(), 'mock')).expectedChecksums[1]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(graph.sends()).toHaveLength(1);
    expect(transmission).toMatchObject({ status: 'submitted', kind: 'email_dry_run', pages: 1, senderAddress: 'office@funeralhome.example', subject: (draft.body as { subject: string }).subject, internetMessageId: '<test-1@example>' });
  });

  it('step 2: the fax gateway address of the approved number and the 2-page test PDF', async () => {
    await passStep1();
    const graph = fakeGraph();
    const { transmission } = await service.sendFaxTest(ctx(), request(2), 'mock');
    expect((graph.drafts()[0].body as { toRecipients: unknown }).toRecipients).toEqual([{ emailAddress: { address: '3055550101@fax.nuso.io' } }]);
    const [attachment] = graph.attachments();
    expect(attachment.name).toBe('SOLIS-FAX-TEST-2-PAGES.pdf');
    expect((await PDFDocument.load(Buffer.from(attachment.contentBytes, 'base64'))).getPageCount()).toBe(2);
    expect(transmission).toMatchObject({ kind: 'fax', pages: 2, recipientDisplay: '305-555-0101' });
  });

  it('the test PDFs are fictional and always the same bytes', async () => {
    const [a, b] = [await buildFaxTestPdf(2), await buildFaxTestPdf(2)];
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).toString('latin1')).not.toMatch(/CreationDate|ModDate|Producer|Author/);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(a) });
    const doc = await task.promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(((await (await doc.getPage(p)).getTextContent()).items as Array<{ str: string }>).map((i) => i.str).join(' '));
    await task.destroy();
    expect(pages).toHaveLength(2);
    pages.forEach((text, i) => {
      expect(text).toContain('SOLIS FAX TEST');
      expect(text).toContain(`PAGE ${i + 1} OF 2`);
      expect(text).toContain(`${i + 1}/2`);
      expect(text).toContain('NOT a death certificate application');
    });
  });
});

describe('recorded before Outlook; audited; Outlook submission ≠ NuSo acceptance ≠ delivery', () => {
  it('the record ("contacting") and the attempted audit event exist before Graph is called', async () => {
    let seen: { status?: unknown; attempted: boolean } | null = null;
    fakeGraph({
      onSend: () => {
        seen = { status: testRows().find((r) => r.recordType === 'transmission')?.status, attempted: events().some((e) => e.eventType === 'fax_test.attempted') };
      },
    });
    const firstCallAt = () => order;
    const before = events().length;
    await service.sendFaxTest(ctx(), request(0), 'mock');
    expect(firstCallAt()).toBeGreaterThan(0);
    expect(seen).toEqual({ status: 'contacting', attempted: true });
    expect(events().slice(before).map((e) => [e.eventType, e.category, e.resourceType, e.caseId])).toEqual([
      ['fax_test.attempted', 'administration', 'faxTestTransmission', null],
      ['fax_test.submitted', 'administration', 'faxTestTransmission', null],
    ]);
  });

  it('if the attempt cannot be audited, nothing is sent and nothing stays locked', async () => {
    const activity = await import('../activityService');
    const spy = vi.spyOn(activity, 'recordFaxTestEvent').mockRejectedValueOnce(new Error('audit store down'));
    const graph = fakeGraph();
    expect((await err(service.sendFaxTest(ctx(), request(0), 'mock')))?.message).toMatch(/Nothing was sent.*audit/);
    expect(graph.calls).toHaveLength(0);
    expect(testRows().find((r) => r.recordType === 'transmission')?.status).toBe('not_sent');
    expect(testRows().some((r) => r.recordType === 'lock')).toBe(false);
    spy.mockRestore();
  });

  it('the stages are separate records: submitted → NuSo accepted (reference) → delivered (pages received), each audited; then the lock is released', async () => {
    await passStep0();
    fakeGraph();
    const sent = await service.sendFaxTest(ctx(), request(1), 'mock');
    expect(sent.transmission).toMatchObject({ status: 'submitted', submittedAt: expect.any(String), nusoAcceptedAt: null, outcomeAt: null, open: true });
    const accepted = await service.recordFaxTestOutcome(ctx(), sent.transmission.id, { status: 'nuso_accepted', expectedRevision: sent.transmission.revision, nusoReference: 'NS-TEST-1' }, 'mock');
    expect(accepted).toMatchObject({ status: 'nuso_accepted', nusoReference: 'NS-TEST-1', nusoAcceptedAt: expect.any(String), outcomeAt: null, open: true });
    // Stale and out-of-order recordings are refused.
    expect((await err(service.recordFaxTestOutcome(ctx(), sent.transmission.id, { status: 'delivered', expectedRevision: sent.transmission.revision, pagesReceived: 1 }, 'mock')))?.status).toBe(409);
    expect((await err(service.recordFaxTestOutcome(ctx(), sent.transmission.id, { status: 'nuso_accepted', expectedRevision: accepted.revision }, 'mock')))?.status).toBe(409);
    expect((await err(service.recordFaxTestOutcome(ctx(), sent.transmission.id, { status: 'delivered', expectedRevision: accepted.revision }, 'mock')))?.message).toMatch(/pages actually received/);
    const delivered = await service.recordFaxTestOutcome(ctx(), sent.transmission.id, { status: 'delivered', expectedRevision: accepted.revision, pagesReceived: 1 }, 'mock');
    expect(delivered).toMatchObject({ status: 'delivered', pagesReceived: 1, passed: true, open: false, next: [] });
    expect(delivered.history.map((h) => h.to)).toEqual(['contacting', 'submitted', 'nuso_accepted', 'delivered']);
    expect(events().filter((e) => e.resourceId === sent.transmission.id).map((e) => e.eventType)).toEqual(['fax_test.attempted', 'fax_test.submitted', 'fax_test.outcome_recorded', 'fax_test.outcome_recorded']);
    expect(testRows().some((r) => r.recordType === 'lock')).toBe(false);
  });

  it('a dry run passes only when every inspection check held', async () => {
    fakeGraph();
    const { transmission } = await service.sendFaxTest(ctx(), request(0), 'mock');
    expect((await err(service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'nuso_accepted', expectedRevision: transmission.revision }, 'mock')))?.status).toBe(409);
    expect((await err(service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, checks: { fromConnectedMailbox: true } }, 'mock')))?.message).toMatch(/every dry-run check/);
    const recorded = await service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, checks: { fromConnectedMailbox: true, subjectAsExpected: true, emptyPlainTextBody: false, exactlyOnePdf: true, checksumMatches: true }, note: 'A disclaimer footer was added' }, 'mock');
    expect(recorded).toMatchObject({ passed: false, checks: { emptyPlainTextBody: false } });
    expect((await err(service.sendFaxTest(ctx(), request(1), 'mock')))?.message).toMatch(/Step 0 must pass first/);
  });
});

describe('no retries; uncertain stays blocked; duplicates impossible', () => {
  it('a dropped connection on the send call: ONE send call, "needs review", never retried — and everything stays blocked until an administrator records what happened', async () => {
    const graph = fakeGraph({ sendThrows: true });
    const e = await err(service.sendFaxTest(ctx(), request(0), 'mock'));
    expect(e?.message).toMatch(/may still have been sent. It will not be retried/);
    expect(graph.sends()).toHaveLength(1);
    const [t] = (await service.getFaxTestOverview(ctx(), 'mock')).transmissions;
    expect(t).toMatchObject({ status: 'needs_review', open: true, next: ['not_sent', 'delivered', 'failed'] });
    expect(events().at(-1)).toMatchObject({ eventType: 'fax_test.needs_review', severity: 'warning' });

    // Blocked: any new test, with any submission id.
    const after = fakeGraph();
    expect((await err(service.sendFaxTest(ctx(), request(0), 'mock')))?.message).toMatch(/Another test transmission is open/);
    expect(after.calls).toHaveLength(0);
    // "Not sent" needs a reason; then it is resolved and the next test may go.
    expect((await err(service.recordFaxTestOutcome(ctx(), t.id, { status: 'not_sent', expectedRevision: t.revision }, 'mock')))?.message).toMatch(/how you confirmed/);
    await service.recordFaxTestOutcome(ctx(), t.id, { status: 'not_sent', expectedRevision: t.revision, note: 'Not in Sent Items; nothing arrived' }, 'mock');
    await service.sendFaxTest(ctx(), request(0), 'mock');
    expect(after.sends()).toHaveLength(1);
  });

  it('a server error on the send call is uncertain too (one call, needs review)', async () => {
    const graph = fakeGraph({ sendStatus: 503 });
    await err(service.sendFaxTest(ctx(), request(0), 'mock'));
    expect(graph.sends()).toHaveLength(1);
    expect((await service.getFaxTestOverview(ctx(), 'mock')).transmissions[0].status).toBe('needs_review');
  });

  it('Outlook refusing before the send (could not have sent): "not sent", the draft is removed, the lock released, no retry', async () => {
    const graph = fakeGraph({ createStatus: 403 });
    expect((await err(service.sendFaxTest(ctx(), request(0), 'mock')))?.message).toMatch(/Outlook could not create the email.*Nothing was sent/);
    expect(graph.sends()).toHaveLength(0);
    expect(graph.drafts()).toHaveLength(1);
    const overview = await service.getFaxTestOverview(ctx(), 'mock');
    expect(overview.transmissions[0]).toMatchObject({ status: 'not_sent', open: false });
    expect(overview.openTransmissionId).toBeNull();
  });

  it('the same submission twice (double click, refresh, retried request): one send; the second reports the first', async () => {
    const graph = fakeGraph();
    const input = request(0);
    const first = await service.sendFaxTest(ctx(), input, 'mock');
    const again = await service.sendFaxTest(ctx(), input, 'mock');
    expect(again).toMatchObject({ duplicate: true, transmission: { id: first.transmission.id, status: 'submitted' } });
    expect(graph.sends()).toHaveLength(1);
  });

  it('concurrent requests — five at once with different submission ids, or the same one — exactly ONE send', async () => {
    const graph = fakeGraph();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.sendFaxTest(ctx(), request(0), 'mock')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => /open|being sent/.test(((r as PromiseRejectedResult).reason as Error).message))).toBe(true);
    expect(graph.sends()).toHaveLength(1);
    expect(testRows().filter((r) => r.recordType === 'transmission')).toHaveLength(1);

    memoryFaxTable.reset();
    const graph2 = fakeGraph();
    const same = request(0);
    const twins = await Promise.allSettled(Array.from({ length: 5 }, () => service.sendFaxTest(ctx(), same, 'mock')));
    expect(graph2.sends()).toHaveLength(1);
    expect(twins.filter((r) => r.status === 'fulfilled' && !r.value.duplicate)).toHaveLength(1);
  });

  it('two administrators recording an outcome at once: the second is told it changed', async () => {
    fakeGraph();
    const { transmission } = await service.sendFaxTest(ctx(), request(0), 'mock');
    const checks = { fromConnectedMailbox: true, subjectAsExpected: true, emptyPlainTextBody: true, exactlyOnePdf: true, checksumMatches: true };
    const both = await Promise.allSettled([
      service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'delivered', expectedRevision: transmission.revision, checks }, 'mock'),
      service.recordFaxTestOutcome(ctx(), transmission.id, { status: 'failed', expectedRevision: transmission.revision }, 'mock'),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('isolated from real fax bundles; operational sending stays off', () => {
  it('a full test run writes nothing but test records and their audit events — no bundle, claim, case or checklist — and Send Fax still refuses', async () => {
    await passStep1();
    expect(memoryFaxTable.rows('faxBundles')).toHaveLength(0);
    expect(memoryFaxTable.rows('faxBundleCases')).toHaveLength(0);
    expect(events().every((e) => e.caseId === null && e.eventType.startsWith('fax_test.'))).toBe(true);
    const e = await faxBundles.sendFaxBundle(ctx(), 'fxb-00000000000000000000000000000000', 'submission-bundle', 'mock').then(() => null, (x: Error & { status: number }) => x);
    expect(e).toMatchObject({ status: 409, message: expect.stringMatching(/Fax sending is not active yet.*Nothing was sent/) });
  });

  it('before the Wix collection exists, nothing can be sent: the attempt cannot be recorded', async () => {
    const { WixDataApiError } = await import('@/lib/wixDataApi');
    setFaxTableForTesting({
      ...memoryFaxTable,
      insert: async () => {
        throw new WixDataApiError('WDE0025: The faxTestTransmissions collection does not exist.', 404);
      },
      find: async () => [],
    });
    const graph = fakeGraph();
    expect((await err(service.sendFaxTest(ctx(), request(0), 'mock')))?.message).toMatch(/Nothing was sent/);
    expect(graph.calls).toHaveLength(0);
  });
});

describe('fax test orchestration boundary (structural)', () => {
  const ROOT = join(__dirname, '../..');
  const SKIP = new Set(['node_modules', '.next', '.git', 'coverage']);
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (['.ts', '.tsx'].includes(extname(name)) && !name.includes('.test.')) files.push(path);
    }
  })(ROOT);
  const rel = (p: string) => p.slice(ROOT.length + 1);

  it('only faxTestService.ts imports the fax test store; only it records fax_test.* events', () => {
    expect(files.filter((f) => /from '(\.\/|\.\.\/faxTests\/|@\/services\/faxTests\/)faxTestStore'/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['services/faxTests/faxTestService.ts']);
    expect(files.filter((f) => /recordFaxTestEvent\(/.test(readFileSync(f, 'utf8'))).map(rel).sort()).toEqual(['services/activityService.ts', 'services/faxTests/faxTestService.ts']);
  });

  it('the fax test modules never touch bundles, cases, documents or checklists', () => {
    for (const f of ['services/faxTests/faxTestService.ts', 'services/faxTests/faxTestStore.ts']) {
      const imports = readFileSync(join(ROOT, f), 'utf8').split('\n').filter((l) => /^import |^\} from /.test(l)).join('\n');
      expect(imports).not.toMatch(/faxBundleService|caseWriteService|caseDocument|checklist|cases\/|faxBundlePdf/i);
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/insertFaxBundle|updateFaxBundleIf|'faxBundles'|'faxBundleCases'/);
    }
  });
});
