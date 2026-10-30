import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { casesService } from './casesService';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { caseRevision } from '../lib/wixCaseMapper';
import { standardCremationWorkflowTemplateFixture } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot } from '../domain/workflow/snapshot';
import type { Case } from '../types/case';

/**
 * Mock mode mirrors the Wix PATCH route (2026-10): Workflow 3's two "sent to
 * crematory" items are changed by hand only by an administrator.
 */
const snapshot = buildCaseWorkflowSnapshot(standardCremationWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture.versions[0]);
let index = -1;
let original: Case;

beforeEach(() => {
  index = caseFixtures.findIndex((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted);
  original = caseFixtures[index];
  caseFixtures[index] = { ...original, rawStage: 4, workflowSnapshot: snapshot, checklistState: {} };
});
afterEach(() => {
  caseFixtures[index] = original;
});

const update = (patch: Record<string, boolean>, isAdministrator?: boolean) =>
  casesService.update({ organizationId: DEFAULT_ORGANIZATION_ID } as never, original.id, { checklistState: patch }, 'mock', {
    expectedRevision: caseRevision(caseFixtures[index]),
    isAdministrator,
  });

describe('casesService.update (mock) — the two "sent to crematory" items', () => {
  it('staff who are not administrators cannot check or uncheck them; nothing is written', async () => {
    const before = caseFixtures[index];
    await expect(update({ '3:0': true })).rejects.toThrow(/Only an administrator/);
    await expect(update({ '3:1': true }, false)).rejects.toThrow(/Only an administrator/);
    expect(caseFixtures[index]).toBe(before);
  });

  it('an administrator can', async () => {
    const updated = await update({ '3:0': true, '3:1': true }, true);
    expect(updated.checklistState).toMatchObject({ '3:0': true, '3:1': true });
  });

  it('every other item is unaffected', async () => {
    const updated = await update({ '2:0': true });
    expect(updated.checklistState['2:0']).toBe(true);
  });
});
