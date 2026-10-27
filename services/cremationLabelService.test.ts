import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

/**
 * Cremation Label (2026-10). The real label service and the real case
 * document pipeline in mock mode, with document storage kept in memory and
 * fictional case values only. No printer or DYMO Connect is involved: none
 * is needed to save or read a label.
 */
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, { buffer: Buffer; contentType: string }>() }));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string, contents: Buffer, contentType: string) => {
      blobs.set(key, { buffer: Buffer.from(contents), contentType });
      return { storageKey: key };
    },
    downloadFile: async (key: string) => {
      const blob = blobs.get(key);
      if (!blob) throw new Error(`no blob ${key}`);
      return { buffer: Buffer.from(blob.buffer), contentType: blob.contentType };
    },
    deleteFile: async (key: string) => void blobs.delete(key),
  },
}));

const { getCremationLabelState, saveCremationLabel, readSavedCremationLabel, recordSavedCremationLabelPrinted, CremationLabelError } = await import('./cremationLabelService');
const { caseFixtures } = await import('./__mocks__/fixtures');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { activityEventFixtures } = await import('./__mocks__/activityEventFixtures');
const { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');
const { MANORS_LABEL_TEMPLATE_XML } = await import('@/domain/labels/manorsLabelTemplate.generated');
import type { Case } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';

const CASE_ID = '1042';
const index = caseFixtures.findIndex((c) => c.id === CASE_ID && c.organizationId === DEFAULT_ORGANIZATION_ID);
const original: Case = caseFixtures[index];
const ctx = (actorIdentityId = 'staff-dana') => ({ organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId, actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-label' });

const EXISTING_DOCUMENT: CaseDocument = {
  id: 'existing-envelope',
  organizationId: DEFAULT_ORGANIZATION_ID,
  caseId: CASE_ID,
  origin: 'generated',
  documentTypeKey: 'letter.envelope',
  category: 'letter',
  fileName: 'Envelope.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 9,
  checksumSha256: 'x'.repeat(64),
  storageKey: 'managed-cremations/1042/existing-envelope.pdf',
  status: 'active',
  templateId: null,
  templateVersion: null,
  version: 1,
  supersedesId: null,
  signatureStatus: null,
  familyVisible: false,
  generatedBy: 'staff-other',
  uploadedBy: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  correlationId: 'corr-existing',
};

let lengths = { documents: 0, activity: 0 };
beforeEach(() => {
  lengths = { documents: caseDocumentFixtures.length, activity: activityEventFixtures.length };
  caseFixtures[index] = { ...original, decedentName: 'JUNIPER FAIRWEATHER', decedentMiddleName: 'QUINN', tagNumber: '90210', dateOfCremation: '10/24/2026' };
  caseDocumentFixtures.push({ ...EXISTING_DOCUMENT });
});
afterEach(() => {
  caseFixtures[index] = original;
  caseDocumentFixtures.length = lengths.documents;
  activityEventFixtures.length = lengths.activity;
  blobs.clear();
});

const labelEvents = () => activityEventFixtures.slice(lengths.activity).filter((e) => e.caseId === CASE_ID && e.category === 'documents');

describe('saving a Cremation Label', () => {
  it('stores the filled label as a case document — no printer or DYMO Connect involved', async () => {
    const { outcome, document } = await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    expect(outcome).toBe('saved');
    expect(document).toMatchObject({
      origin: 'generated',
      documentTypeKey: 'cremation_form.cremation_label',
      fileName: 'Cremation Label.dymo',
      mimeType: 'application/vnd.dymo.label+xml',
      status: 'active',
      version: 1,
      generatedBy: 'staff-dana',
    });

    const stored = blobs.get(document.storageKey)!;
    expect(stored.contentType).toBe('application/vnd.dymo.label+xml');
    // The file is the approved template with only the three values changed,
    // saved with the template file's own byte-order mark.
    const text = stored.buffer.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const expected = MANORS_LABEL_TEMPLATE_XML.replace('<Text>Richard Lewis Reynolds</Text>', '<Text>Juniper Quinn Fairweather</Text>')
      .replace('<Text>Tag #44471</Text>', '<Text>Tag #90210</Text>');
    expect(text.slice(1)).toBe(expected);
    expect(document.checksumSha256).toBe(createHash('sha256').update(stored.buffer).digest('hex'));

    expect(labelEvents().map((e) => e.eventType)).toContain('document.generated');
  });

  it('is retrievable afterwards — on a fresh request and by another authorized staff member', async () => {
    const { document } = await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    const state = await getCremationLabelState(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(state!.latest).toMatchObject({ documentId: document.id, version: 1, values: { name: 'Juniper Quinn Fairweather', tag: 'Tag #90210', date: 'October 24, 2026' } });
    expect(state!.latestMatchesCase).toBe(true);

    // Reading involves no session state: what one person saved, anyone in
    // the organization reads back, byte for byte.
    const read = await readSavedCremationLabel(DEFAULT_ORGANIZATION_ID, CASE_ID, document.id, 'mock');
    expect(`﻿${read.labelXml}`).toBe(blobs.get(document.storageKey)!.buffer.toString('utf8'));
    expect(read.isLatest).toBe(true);
  });

  it('saving again with nothing changed creates nothing', async () => {
    const first = await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    const again = await saveCremationLabel(ctx(), CASE_ID, first.document.id, 'mock');
    expect(again).toEqual({ outcome: 'unchanged', document: expect.objectContaining({ id: first.document.id }) });
    expect(caseDocumentFixtures.filter((d) => d.documentTypeKey === 'cremation_form.cremation_label')).toHaveLength(1);
  });

  it('refuses with the missing values named, and saves nothing', async () => {
    caseFixtures[index] = { ...caseFixtures[index], dateOfCremation: null };
    await expect(saveCremationLabel(ctx(), CASE_ID, null, 'mock')).rejects.toMatchObject({ status: 422, message: "Can't print the label yet. Add the Date of Cremation to this case first." });
    expect(caseDocumentFixtures).toHaveLength(lengths.documents + 1);
  });

  it('does not touch the case\'s other documents', async () => {
    await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    expect(caseDocumentFixtures.find((d) => d.id === 'existing-envelope')).toEqual(EXISTING_DOCUMENT);
  });

  it('another organization cannot see or read the label', async () => {
    const { document } = await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    expect(await getCremationLabelState(SECOND_MOCK_ORGANIZATION_ID, CASE_ID, 'mock')).toBeNull();
    await expect(readSavedCremationLabel(SECOND_MOCK_ORGANIZATION_ID, CASE_ID, document.id, 'mock')).rejects.toMatchObject({ status: 404 });
  });
});

describe('when the case changes after a label was saved', () => {
  it('keeps the saved label, flags the change, and only an explicit save makes version 2', async () => {
    const v1 = (await saveCremationLabel(ctx(), CASE_ID, null, 'mock')).document;
    const v1Bytes = Buffer.from(blobs.get(v1.storageKey)!.buffer);

    caseFixtures[index] = { ...caseFixtures[index], tagNumber: '90211' };
    const changed = await getCremationLabelState(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(changed!.latestMatchesCase).toBe(false);
    expect(changed!.latest!.values!.tag).toBe('Tag #90210'); // the saved label is unchanged
    expect(changed!.current).toMatchObject({ ok: true, values: { tag: 'Tag #90211' } });

    // Someone who never saw v1 cannot replace it.
    await expect(saveCremationLabel(ctx(), CASE_ID, null, 'mock')).rejects.toMatchObject({ status: 409 });

    const v2 = (await saveCremationLabel(ctx('staff-lee'), CASE_ID, v1.id, 'mock')).document;
    expect(v2).toMatchObject({ version: 2, supersedesId: v1.id, status: 'active', generatedBy: 'staff-lee' });

    const v1Now = caseDocumentFixtures.find((d) => d.id === v1.id)!;
    expect(v1Now.status).toBe('superseded');
    expect(v1Now.checksumSha256).toBe(v1.checksumSha256);
    expect(blobs.get(v1.storageKey)!.buffer.equals(v1Bytes)).toBe(true);

    const older = await readSavedCremationLabel(DEFAULT_ORGANIZATION_ID, CASE_ID, v1.id, 'mock');
    expect(older).toMatchObject({ isLatest: false, values: { tag: 'Tag #90210' } });
    const latest = await getCremationLabelState(DEFAULT_ORGANIZATION_ID, CASE_ID, 'mock');
    expect(latest!.latest).toMatchObject({ documentId: v2.id, version: 2, values: { tag: 'Tag #90211' } });
    expect(latest!.latestMatchesCase).toBe(true);

    expect(labelEvents().map((e) => e.eventType)).toEqual(expect.arrayContaining(['document.generated', 'document.regenerated']));
  });
});

describe('printing a saved label', () => {
  it('records who sent which saved version to which printer', async () => {
    const { document } = await saveCremationLabel(ctx(), CASE_ID, null, 'mock');
    await recordSavedCremationLabelPrinted(ctx('staff-lee'), CASE_ID, document.id, 'DYMO LabelWriter 550', 'mock');
    const printed = labelEvents().find((e) => e.eventType === 'document.label_printed')!;
    expect(printed).toMatchObject({ actorIdentityId: 'staff-lee', resourceId: document.id, description: 'Cremation Label v1 sent to DYMO LabelWriter 550' });
  });

  it('refuses a document that is not one of this case\'s labels', async () => {
    await expect(recordSavedCremationLabelPrinted(ctx(), CASE_ID, 'existing-envelope', 'P', 'mock')).rejects.toBeInstanceOf(CremationLabelError);
    await expect(readSavedCremationLabel(DEFAULT_ORGANIZATION_ID, CASE_ID, 'existing-envelope', 'mock')).rejects.toMatchObject({ status: 404 });
  });
});
