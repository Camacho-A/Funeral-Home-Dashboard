import { describe, expect, it } from 'vitest';
import { averageDaysInStageSnapshot, caseCountsByStage, countActiveCases } from './reportingService';
import { caseFixtures } from './__mocks__/fixtures';
import { buildPortalCaseView } from '../domain/portal/portalCaseView';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import { STAGES, LAST_DISPLAY_STAGE } from '../domain/cases/stages';

/**
 * Service-specific workflows (2026-10). Reports for Gus Camacho Jr. group
 * by its own organization stages and read each case's own workflow; Manors
 * keeps the STAGES-based rows. Mock data only.
 */

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const GUS_LABELS = [
  'First Call & Payment',
  'JotForm Application',
  'EDRS & Doctor / Cause of Death',
  'Permit & Authorization Sent to Crematory',
  'Death Certificate Application Sent',
  'Ready for Pickup / Contact Family',
  'Completed',
];

describe('Gus reports', () => {
  it('stage counts use the Gus stage names and add up to every active Gus case', async () => {
    const rows = await caseCountsByStage(GUS, 'mock');
    expect(rows.map((r) => r.stage)).toEqual(GUS_LABELS);
    const gusCases = caseFixtures.filter((c) => c.organizationId === GUS && !c.isDeleted);
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(gusCases.length);
  });

  it('the stage breakdown takes SLA targets from the workflow itself', async () => {
    const rows = await averageDaysInStageSnapshot(GUS, 'mock');
    expect(rows.map((r) => r.label)).toEqual(GUS_LABELS);
    expect(rows.find((r) => r.label === 'EDRS & Doctor / Cause of Death')!.targetLabel).toBe(
      (await averageDaysInStageSnapshot(MANORS, 'mock')).find((r) => r.label === 'EDRS & Doctor / Cause of Death')!.targetLabel,
    );
  });

  it('active cases are counted against each case’s own workflow (same result as before while every case is Direct Cremation)', async () => {
    const views = caseFixtures
      .filter((c) => c.organizationId === GUS && !c.isDeleted)
      .map((c) => buildCaseViewModel(c, { staffList: [] }));
    expect(await countActiveCases(GUS, {}, 'mock')).toBe(views.filter((v) => v.displayStage < LAST_DISPLAY_STAGE).length);
  });

  it('the family portal shows the case’s own stage name', () => {
    const atDeathCertificate = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 5)!;
    expect(buildPortalCaseView(atDeathCertificate).stageLabel).toBe('Death Certificate Application Sent');
  });
});

describe('Manors reports are unchanged', () => {
  it('stage counts keep the presented STAGES rows', async () => {
    const rows = await caseCountsByStage(MANORS, 'mock');
    expect(rows.map((r) => r.stage)).toEqual(['Intake & JotForm', ...STAGES.slice(2)]);
  });
});
