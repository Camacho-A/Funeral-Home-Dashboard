import { describe, it, expect } from 'vitest';
import {
  mapWixDocumentTemplateItem,
  mapWixDocumentTemplateVersionItem,
  buildDocumentTemplate,
  buildWixDocumentTemplateData,
  buildWixDocumentTemplateVersionData,
  applyDocumentTemplateStatusToWixData,
} from './wixDocumentTemplateMapper';
import type { DocumentTemplateVersion } from '../types/documentTemplate';

const SUMMARY = {
  id: 'template-1',
  organizationId: 'org-1',
  isSystemTemplate: false,
  name: 'Cremation Authorization',
  documentTypeKey: 'authorization.cremation',
  category: 'authorization' as const,
  status: 'active' as const,
};

const VERSION_1: DocumentTemplateVersion = {
  templateId: 'template-1',
  version: 1,
  body: '<p>Dear {{case.primaryContact.fullName}},</p>',
  mergeFieldsUsed: ['case.primaryContact.fullName'],
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'identity-1',
};

const VERSION_2: DocumentTemplateVersion = {
  ...VERSION_1,
  version: 2,
  body: '<p>Dear {{case.primaryContact.fullName}}, regarding {{case.decedent.fullName}}.</p>',
  mergeFieldsUsed: ['case.primaryContact.fullName', 'case.decedent.fullName'],
};

describe('wixDocumentTemplateMapper — template identity', () => {
  it('round-trips a template summary', () => {
    expect(mapWixDocumentTemplateItem(buildWixDocumentTemplateData(SUMMARY))).toEqual(SUMMARY);
  });

  it('round-trips a system template with organizationId null', () => {
    const systemSummary = { ...SUMMARY, isSystemTemplate: true, organizationId: null };
    expect(mapWixDocumentTemplateItem(buildWixDocumentTemplateData(systemSummary))).toEqual(systemSummary);
  });

  it('returns null for undefined or an invalid category/status', () => {
    expect(mapWixDocumentTemplateItem(undefined)).toBeNull();
    expect(mapWixDocumentTemplateItem({ ...buildWixDocumentTemplateData(SUMMARY), category: 'bogus' })).toBeNull();
    expect(mapWixDocumentTemplateItem({ ...buildWixDocumentTemplateData(SUMMARY), status: 'bogus' })).toBeNull();
  });

  it('applyDocumentTemplateStatusToWixData changes only status', () => {
    const wixItem = buildWixDocumentTemplateData(SUMMARY);
    const updated = applyDocumentTemplateStatusToWixData(wixItem, 'archived');
    expect(updated.status).toBe('archived');
    expect(updated.name).toBe(wixItem.name);
  });
});

describe('wixDocumentTemplateMapper — version identity', () => {
  it('round-trips a version', () => {
    expect(mapWixDocumentTemplateVersionItem(buildWixDocumentTemplateVersionData(VERSION_1))).toEqual(VERSION_1);
  });

  it('returns null for undefined or a malformed field', () => {
    expect(mapWixDocumentTemplateVersionItem(undefined)).toBeNull();
    expect(mapWixDocumentTemplateVersionItem({ ...buildWixDocumentTemplateVersionData(VERSION_1), version: '1' })).toBeNull();
    expect(mapWixDocumentTemplateVersionItem({ ...buildWixDocumentTemplateVersionData(VERSION_1), mergeFieldsUsed: 'not-an-array' })).toBeNull();
  });
});

describe('buildDocumentTemplate', () => {
  it('joins a summary with its versions, sorted ascending, latest = versions[length-1]', () => {
    const template = buildDocumentTemplate(SUMMARY, [VERSION_2, VERSION_1]);
    expect(template?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(template?.versions[template.versions.length - 1].version).toBe(2);
  });

  it('returns null when there are zero valid versions', () => {
    expect(buildDocumentTemplate(SUMMARY, [])).toBeNull();
  });
});
