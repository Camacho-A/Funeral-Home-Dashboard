import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  list,
  get,
  createTemplate,
  createVersion,
  cloneTemplate,
  archiveTemplate,
  restoreTemplate,
  getActiveVersion,
  previewTemplate,
  DocumentTemplateServiceError,
} from './documentTemplatesService';
import { documentTemplateFixtures } from './__mocks__/documentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { ActivityContext } from './activityService';
import type { MergeSourceData } from '../domain/documents/mergeEngine';
import type { Case } from '../types/case';
import type { Organization } from '../types/organization';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `doc-template-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'manager',
    correlationId: 'corr-1',
    ...overrides,
  };
}

let lengths: { templates: number; events: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { templates: documentTemplateFixtures.length, events: activityEventFixtures.length };
});
afterEach(() => {
  documentTemplateFixtures.length = lengths.templates;
  activityEventFixtures.length = lengths.events;
});

async function createSampleTemplate(overrides: Partial<Parameters<typeof createTemplate>[0]> = {}) {
  return createTemplate(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      name: 'Cremation Authorization',
      documentTypeKey: 'authorization.cremation',
      category: 'authorization',
      body: '<p>Dear {{case.primaryContact.fullName}},</p>',
      idFactory,
      ...overrides,
    },
    ctx(),
    'mock',
  );
}

describe('createTemplate', () => {
  it('creates a template with version 1 and records document.template.created', async () => {
    const template = await createSampleTemplate();
    expect(template.versions).toHaveLength(1);
    expect(template.versions[0].version).toBe(1);
    expect(template.status).toBe('active');

    const created = activityEventFixtures.at(-1);
    expect(created?.eventType).toBe('document.template.created');
  });

  it('rejects an unrecognized documentTypeKey', async () => {
    await expect(createSampleTemplate({ documentTypeKey: 'not.a.real.key' })).rejects.toThrow(DocumentTemplateServiceError);
  });

  it('rejects a body referencing an unrecognized merge field', async () => {
    await expect(createSampleTemplate({ body: '<p>{{bogus.field}}</p>' })).rejects.toThrow(/bogus\.field/);
  });

  it('sanitizes the body before storing it', async () => {
    const template = await createSampleTemplate({ body: '<p>Hi</p><script>alert(1)</script>' });
    expect(template.versions[0].body).not.toContain('<script');
  });

  it('computes mergeFieldsUsed from the sanitized body', async () => {
    const template = await createSampleTemplate({
      body: '<p>{{case.primaryContact.fullName}} — {{case.decedent.fullName}}</p>',
    });
    expect(template.versions[0].mergeFieldsUsed.sort()).toEqual(['case.decedent.fullName', 'case.primaryContact.fullName']);
  });
});

describe('createVersion', () => {
  it('appends a new version without mutating the prior one', async () => {
    const template = await createSampleTemplate();
    const updated = await createVersion({ organizationId: DEFAULT_ORGANIZATION_ID, templateId: template.id, body: '<p>Updated: {{case.decedent.fullName}}</p>', idFactory }, ctx(), 'mock');

    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]).toEqual(template.versions[0]); // untouched
    expect(updated.versions[1].version).toBe(2);
    expect(getActiveVersion(updated).version).toBe(2);

    const recorded = activityEventFixtures.at(-1);
    expect(recorded?.eventType).toBe('document.template.updated');
  });

  it('throws for a template that does not exist', async () => {
    await expect(createVersion({ organizationId: DEFAULT_ORGANIZATION_ID, templateId: 'no-such-template', body: '<p>x</p>', idFactory }, ctx(), 'mock')).rejects.toThrow(
      DocumentTemplateServiceError,
    );
  });
});

describe('cloneTemplate', () => {
  it('produces an independent template — the source is never modified', async () => {
    const source = await createSampleTemplate({ name: 'Original' });
    const clone = await cloneTemplate({ organizationId: DEFAULT_ORGANIZATION_ID, sourceTemplateId: source.id, name: 'Copy of Original', idFactory }, ctx(), 'mock');

    expect(clone.id).not.toBe(source.id);
    expect(clone.name).toBe('Copy of Original');
    expect(clone.versions[0].body).toBe(source.versions[0].body);
    expect(clone.documentTypeKey).toBe(source.documentTypeKey);

    const reloadedSource = await get(DEFAULT_ORGANIZATION_ID, source.id, 'mock');
    expect(reloadedSource?.name).toBe('Original');
    expect(reloadedSource?.versions).toHaveLength(1);
  });
});

describe('archiveTemplate / restoreTemplate', () => {
  it('flips status to archived, then back to active, each recording its own event', async () => {
    const template = await createSampleTemplate();

    await archiveTemplate(DEFAULT_ORGANIZATION_ID, template.id, ctx(), 'mock');
    let reloaded = await get(DEFAULT_ORGANIZATION_ID, template.id, 'mock');
    expect(reloaded?.status).toBe('archived');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.template.archived');

    await restoreTemplate(DEFAULT_ORGANIZATION_ID, template.id, ctx(), 'mock');
    reloaded = await get(DEFAULT_ORGANIZATION_ID, template.id, 'mock');
    expect(reloaded?.status).toBe('active');
    expect(activityEventFixtures.at(-1)?.eventType).toBe('document.template.restored');
  });
});

describe('list / get — tenant isolation', () => {
  it('never returns another organization\'s templates', async () => {
    await createSampleTemplate();
    await createSampleTemplate({ organizationId: SECOND_MOCK_ORGANIZATION_ID });

    const orgList = await list(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(orgList).toHaveLength(1);
    expect(orgList[0].organizationId).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it('get returns null for a template belonging to a different organization', async () => {
    const template = await createSampleTemplate();
    expect(await get(SECOND_MOCK_ORGANIZATION_ID, template.id, 'mock')).toBeNull();
  });
});

describe('previewTemplate', () => {
  it('merges a body against real source data, no persistence involved', () => {
    const source: MergeSourceData = {
      case: { decedentName: 'Robert Ellison', nextOfKinName: 'Margaret Ellison' } as unknown as Case,
      caseOrder: null,
      organization: { name: "Manor's Cremation" } as unknown as Organization,
      branding: null,
      location: null,
      serviceAppointment: null,
      serviceAppointmentLocation: null,
    };
    const html = previewTemplate('<p>Dear {{case.primaryContact.fullName}}, re: {{case.decedent.fullName}}.</p>', source);
    expect(html).toBe('<p>Dear Margaret Ellison, re: Robert Ellison.</p>');
  });
});
