import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { runAfterResponse } from '@/lib/afterResponse';
import { fixtureIdentitySession } from '@/lib/auth/testing/fixtureIdentityAuth';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { MANORS_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';

/**
 * Date of Cremation, end to end (2026-10). The REAL PATCH route, the REAL
 * Certificate trigger, the REAL document service (versioning, superseding,
 * audit) and the REAL PDF fill run together on fictional cases. Only the
 * two outside systems are replaced, by in-memory stand-ins:
 *
 *   Wix Data          an in-memory store per collection (lib/wixDataApi)
 *   Document storage  an in-memory map (Vercel Blob provider)
 *
 * `fetch` itself is blocked, so nothing here can reach Wix, Vercel Blob or
 * any live case record or Production document, even by mistake. The
 * certificate template is a stand-in with the official field names, never
 * the signed original.
 */

// ---- In-memory Wix Data -------------------------------------------------

type Row = Record<string, unknown>;
const store = new Map<string, Map<string, Row>>();
const collection = (name: string) => {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name)!;
};
const item = (dataCollectionId: string, id: string, data: Row) => ({ id, dataCollectionId, data: { ...data, _id: id } });

function matches(row: Row, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, test]) => {
    if (key === '$and') return (test as Row[]).every((f) => matches(row, f));
    if (key === '$or') return (test as Row[]).some((f) => matches(row, f));
    const value = row[key] ?? null;
    if (test === null || typeof test !== 'object' || Array.isArray(test)) return value === (test ?? null);
    return Object.entries(test as Row).every(([op, operand]) => {
      switch (op) {
        case '$eq':
          return value === (operand ?? null);
        case '$ne':
          return value !== (operand ?? null);
        case '$in':
          return (operand as unknown[]).includes(value);
        case '$hasSome':
          return Array.isArray(value) && (operand as unknown[]).some((o) => value.includes(o));
        case '$exists':
          return (value !== null) === operand;
        case '$gt':
          return value !== null && (value as string) > (operand as string);
        case '$gte':
          return value !== null && (value as string) >= (operand as string);
        case '$lt':
          return value !== null && (value as string) < (operand as string);
        case '$lte':
          return value !== null && (value as string) <= (operand as string);
        default:
          throw new Error(`in-memory Wix: unsupported filter operator ${op}`);
      }
    });
  });
}

const select = (name: string, filter?: Record<string, unknown>) =>
  [...collection(name).entries()].filter(([, row]) => matches(row, filter)).map(([id, row]) => item(name, id, row));

vi.mock('@/lib/wixDataApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/wixDataApi')>();
  let nextId = 1;
  return {
    ...original,
    queryWixDataItems: async (name: string, query: { filter?: Record<string, unknown> } = {}) => {
      const dataItems = select(name, query.filter);
      return { dataItems, pagingMetadata: { count: dataItems.length, total: dataItems.length } };
    },
    queryAllWixDataItems: async (name: string, filter?: Record<string, unknown>) => select(name, filter),
    countWixDataItems: async (name: string, filter?: Record<string, unknown>) => select(name, filter).length,
    insertWixDataItem: async (name: string, data: Row, itemId?: string) => {
      const id = itemId ?? `${name}-${nextId++}`;
      collection(name).set(id, { ...data });
      return item(name, id, data);
    },
    updateWixDataItem: async (name: string, id: string, data: Row) => {
      collection(name).set(id, { ...data });
      return item(name, id, data);
    },
    deleteWixDataItem: async (name: string, id: string) => {
      collection(name).delete(id);
    },
    conditionalPatchWixDataItemFields: async (name: string, id: string, fields: Row, condition: { filter: Record<string, unknown> }) => {
      const row = collection(name).get(id);
      if (!row) return { applied: false, status: 404 };
      if (!matches(row, condition.filter)) return { applied: false, status: 428 };
      const next = { ...row, ...fields };
      collection(name).set(id, next);
      return { applied: true, dataItem: item(name, id, next) };
    },
  };
});

// ---- In-memory document storage ----------------------------------------

const blobs = new Map<string, Buffer>();
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', async () => {
  const { DocumentNotFoundError } = await import('@/lib/documentStorageProvider');
  return {
    vercelBlobStorageProvider: {
      uploadFile: async (key: string, contents: Buffer) => {
        blobs.set(key, Buffer.from(contents));
        return { storageKey: key };
      },
      downloadFile: async (key: string) => {
        const buffer = blobs.get(key);
        if (!buffer) throw new DocumentNotFoundError(key);
        return { buffer, contentType: 'application/pdf' };
      },
      deleteFile: async (key: string) => {
        blobs.delete(key);
      },
    },
  };
});

// The real PDF fill, observed (not replaced) so the printed values can be
// checked — the finished form is flattened.
const { certificateInputs } = vi.hoisted(() => ({ certificateInputs: [] as Array<Record<string, unknown>> }));
vi.mock('@/services/officialDocumentTemplates', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/officialDocumentTemplates')>();
  return {
    ...original,
    buildCertificateOfCremationPdf: async (template: Uint8Array, input: Record<string, unknown>) => {
      certificateInputs.push(input);
      return original.buildCertificateOfCremationPdf(template, input as Parameters<typeof original.buildCertificateOfCremationPdf>[1]);
    },
  };
});

// ---- Session (same fixture identity auth as the route's own tests) -----

let mockSession: ReturnType<typeof fixtureIdentitySession> | null = fixtureIdentitySession(mockDefaultUser);
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
  createSession: async () => undefined,
  clearSession: async () => undefined,
}));
vi.mock('@/lib/auth/resolveIdentitySession', async () => (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureResolveIdentitySessionModule);
vi.mock('@/services/membershipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/membershipService')>()),
  listMembershipsForIdentity: (await import('@/lib/auth/testing/fixtureIdentityAuth')).fixtureListMembershipsForIdentity,
}));

const { GET, PATCH } = await import('./route');

// ---- Fixtures (fictional) ----------------------------------------------

const CASE_ID = 'e2e-cremation-1';

function seedCase(overrides: Row = {}) {
  collection('cases').set(CASE_ID, {
    beaconCaseId: CASE_ID,
    organizationId: MANORS_ORGANIZATION_ID,
    caseNumber: 'E2E-0001',
    caseType: 'cremation',
    workflowTemplateId: 'workflow-template-standard-cremation',
    workflowTemplateVersion: 1,
    workflowSnapshot: { workflowTemplateId: 'workflow-template-standard-cremation', workflowTemplateVersion: 1, stages: [], intake: { sections: [] } },
    intakeOwnerId: 'staff-dana',
    caseHandlerId: 'staff-dana',
    currentStage: 0,
    checklistState: {},
    fieldValues: {},
    decedentName: 'Fictional Testperson',
    dateOfBirth: '01/01/1950',
    dateOfDeath: '07/09/2026',
    timeOfDeath: '06:12',
    placeOfDeath: 'Test Hospital',
    weight: '150 lb',
    nextOfKinName: 'Test Relative',
    nextOfKinPhone: '555-0100',
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    isArchived: false,
    tagNumber: 'T-9001',
    dateOfCremation: null,
    cremainsReceivedAt: null,
    createdBy: 'staff-dana',
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  });
}

function seedAdministratorRole() {
  collection('roles').set('role-administrator', {
    beaconRoleId: 'role-administrator',
    key: 'administrator',
    name: 'Administrator',
    description: 'Full access.',
    organizationId: null,
    isSystemDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  for (const permissionKey of ['case.read', 'case.update']) {
    collection('rolePermissions').set(`rp-${permissionKey}`, {
      beaconRolePermissionId: `rp-${permissionKey}`,
      roleId: 'role-administrator',
      permissionKey,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
}

const storedCase = () => collection('cases').get(CASE_ID)!;
const certificates = () =>
  [...collection('caseDocuments').values()]
    .filter((d) => d.documentTypeKey === DOCUMENT_TYPES.CREMATION_FORM_CERTIFICATE_OF_CREMATION.key)
    .sort((a, b) => Number(a.version) - Number(b.version));
const envelopes = () => [...collection('caseDocuments').values()].filter((d) => d.documentTypeKey === DOCUMENT_TYPES.LETTER_ENVELOPE.key);
const labels = () =>
  [...collection('caseDocuments').values()]
    .filter((d) => d.documentTypeKey === DOCUMENT_TYPES.CREMATION_FORM_CREMATION_LABEL.key)
    .sort((a, b) => Number(a.version) - Number(b.version));

/** A save as either screen sends it, then whatever the route queued to
    run after the response (the official documents), awaited. */
async function save(patch: Row, organizationId: string = MANORS_ORGANIZATION_ID) {
  vi.mocked(runAfterResponse).mockClear();
  const revision = (storedCase().revision as number | undefined) ?? 0;
  const response = await PATCH(
    new Request(`http://localhost/api/cases/${CASE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ organizationId, patch, expectedRevision: revision }),
    }),
    { params: Promise.resolve({ caseId: CASE_ID }) },
  );
  // The activity log and expected pickup run after the response too (2026-10).
  for (const [label, task] of vi.mocked(runAfterResponse).mock.calls) {
    if (!String(label).startsWith('official documents')) await (task as () => Promise<unknown>)();
  }
  const queued = vi.mocked(runAfterResponse).mock.calls.filter(([label]) => String(label).startsWith('official documents'));
  const outcomes = [];
  for (const [, task] of queued) outcomes.push(await (task as () => Promise<unknown>)());
  return { status: response.status, body: await response.json(), documentOutcomes: outcomes };
}

async function load() {
  const response = await GET(new Request(`http://localhost/api/cases/${CASE_ID}?organizationId=${MANORS_ORGANIZATION_ID}`), {
    params: Promise.resolve({ caseId: CASE_ID }),
  });
  return (await response.json()).case as { dateOfCremation: string | null };
}

// ---- Environment --------------------------------------------------------

let templateDir: string;
const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID', 'CERTIFICATE_OF_CREMATION_TEMPLATE_PATH', 'CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY'];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  expect(DEFAULT_ORGANIZATION_ID).toBe(MANORS_ORGANIZATION_ID);
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  // A stand-in with the official field names (the signed original is not
  // in the repository, and is never read here).
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  for (const [name, y] of [['TagNumber', 412], ['Name', 289], ['DateOfCremation', 334], ['DateOfDeath', 316]] as const) {
    form.createTextField(name).addToPage(page, { x: 418, y, width: 126, height: 12 });
  }
  templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-e2e-'));
  await fs.writeFile(path.join(templateDir, 'certificate.pdf'), await doc.save());
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(templateDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.DATA_ADAPTER = 'wix';
  process.env.WIX_API_KEY = 'e2e-placeholder-not-a-key';
  process.env.WIX_SITE_ID = 'e2e-placeholder-site';
  process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH = path.join(templateDir, 'certificate.pdf');
  delete process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    throw new Error(`network blocked in the isolated E2E test: ${String(url)}`);
  }));
  store.clear();
  blobs.clear();
  certificateInputs.length = 0;
  mockSession = fixtureIdentitySession(mockDefaultUser);
  seedAdministratorRole();
});

// ---- Tests ---------------------------------------------------------------

describe('Date of Cremation → save route → Certificate of Cremation (isolated, fictional)', () => {
  it('enter, correct, then explicitly clear: one field, versioned Certificates, nothing generated or removed on clear', async () => {
    seedCase();

    // 1. Entering a valid date: stored as typed, Certificate v1 printed with it.
    const entered = await save({ dateOfCremation: '07/15/2026' });
    expect(entered.status).toBe(200);
    expect(storedCase().dateOfCremation).toBe('07/15/2026');
    // The Cremation Label (2026-10) is saved alongside: it prints the date too.
    expect(entered.documentOutcomes).toEqual([{ certificate_of_cremation: 'generated', cremation_label: 'generated' }]);
    expect(certificates()).toHaveLength(1);
    expect(certificates()[0]).toMatchObject({ version: 1, status: 'active' });
    expect(certificateInputs.at(-1)).toMatchObject({ tagNumber: 'T-9001', dateOfCremation: 'July 15, 2026', dateOfDeath: 'July 9, 2026' });
    expect(envelopes()).toHaveLength(0); // a date change is not an Envelope trigger
    expect((await load()).dateOfCremation).toBe('07/15/2026'); // what both screens read

    // 2. Correcting it: Certificate v2, v1 kept in history (superseded, file kept).
    const corrected = await save({ dateOfCremation: '07/16/2026' });
    expect(corrected.status).toBe(200);
    expect(storedCase().dateOfCremation).toBe('07/16/2026');
    expect(certificates().map((c) => [c.version, c.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    expect(certificateInputs.at(-1)).toMatchObject({ dateOfCremation: 'July 16, 2026' });
    expect(labels().map((l) => [l.version, l.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    const filesBeforeClear = new Map(blobs);
    expect(filesBeforeClear.size).toBe(4); // two Certificates, two labels
    const certificatesBeforeClear = JSON.stringify(certificates());

    // 3. Explicitly clearing it: the field is empty, no document is
    //    generated, and every existing Certificate and file is untouched.
    const cleared = await save({ dateOfCremation: null });
    expect(cleared.status).toBe(200);
    expect(storedCase().dateOfCremation).toBeNull();
    expect(cleared.documentOutcomes).toEqual([{}]);
    expect(JSON.stringify(certificates())).toBe(certificatesBeforeClear);
    expect([...blobs.keys()]).toEqual([...filesBeforeClear.keys()]);
    for (const [key, bytes] of filesBeforeClear) expect(blobs.get(key)!.equals(bytes)).toBe(true);
    expect((await load()).dateOfCremation).toBeNull();

    // Audit: every change is recorded with its previous and next value.
    const audited = [...collection('activityEvents').values()]
      .map((e) => JSON.stringify(e))
      .filter((e) => e.includes('dateOfCremation'));
    expect(audited).toHaveLength(3);
    expect(audited[2]).toContain('07/16/2026');

    // Entering a date again after a clear follows the normal rule: a new
    // Certificate version, the earlier ones kept in history.
    const again = await save({ dateOfCremation: '07/17/2026' });
    expect(again.documentOutcomes).toEqual([{ certificate_of_cremation: 'generated', cremation_label: 'generated' }]);
    expect(certificates().map((c) => c.status)).toEqual(['superseded', 'superseded', 'active']);
  });

  it('refuses a Certificate without a valid Tag Number — and generates nothing else', async () => {
    seedCase({ tagNumber: null });
    const saved = await save({ dateOfCremation: '07/15/2026' });
    expect(saved.status).toBe(200);
    expect(storedCase().dateOfCremation).toBe('07/15/2026');
    expect(saved.documentOutcomes).toEqual([{}]);
    expect(collection('caseDocuments').size).toBe(0);
    expect(blobs.size).toBe(0);
  });

  it('refuses a Certificate without a Date of Death — the label, which does not print it, is still saved', async () => {
    seedCase({ dateOfDeath: '' });
    const saved = await save({ dateOfCremation: '07/15/2026' });
    expect(saved.status).toBe(200);
    expect(saved.documentOutcomes).toEqual([{ cremation_label: 'generated' }]);
    expect(certificates()).toHaveLength(0);
    expect(labels()).toHaveLength(1);
  });

  it('the Certificate is generated once the last missing piece (the Tag Number) arrives, with the saved date', async () => {
    seedCase({ tagNumber: null, dateOfCremation: '07/15/2026' });
    const saved = await save({ tagNumber: 'T-9002' });
    expect(saved.documentOutcomes[0]).toMatchObject({ certificate_of_cremation: 'generated' });
    expect(certificateInputs.at(-1)).toMatchObject({ tagNumber: 'T-9002', dateOfCremation: 'July 15, 2026' });
  });

  it('archived case: refused, nothing written, nothing generated', async () => {
    seedCase({ dateOfCremation: '07/15/2026', isArchived: true, archivedAt: '2026-10-01T00:00:00.000Z' });
    const before = JSON.stringify(storedCase());
    for (const patch of [{ dateOfCremation: '07/16/2026' }, { dateOfCremation: null }]) {
      const attempt = await save(patch);
      expect(attempt.status).toBe(409);
      expect(attempt.documentOutcomes).toEqual([]);
    }
    expect(JSON.stringify(storedCase())).toBe(before);
    expect(collection('caseDocuments').size).toBe(0);
  });

  it('unauthorized: no session, or another organization, cannot change it', async () => {
    seedCase({ dateOfCremation: '07/15/2026' });
    const before = JSON.stringify(storedCase());
    mockSession = null;
    expect((await save({ dateOfCremation: null })).status).toBe(401);
    mockSession = fixtureIdentitySession(mockDefaultUser);
    expect((await save({ dateOfCremation: null }, SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
    expect(JSON.stringify(storedCase())).toBe(before);
    expect(collection('caseDocuments').size).toBe(0);
  });

  it('a future date is refused, nothing written', async () => {
    seedCase();
    const attempt = await save({ dateOfCremation: '12/31/2099' });
    expect(attempt.status).toBe(422);
    expect(storedCase().dateOfCremation).toBeNull();
    expect(collection('caseDocuments').size).toBe(0);
  });
});
