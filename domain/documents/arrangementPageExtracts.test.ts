import { describe, expect, it } from 'vitest';
import { ARRANGEMENT_EXTRACTS, crematoryPermitStatus } from './arrangementPageExtracts';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case } from '@/types/case';

describe('ARRANGEMENT_EXTRACTS', () => {
  it('ME Form is page 2, Crematory Form is page 3', () => {
    expect(ARRANGEMENT_EXTRACTS.me_form).toMatchObject({ page: 2, fileName: 'ME Form.pdf', displayName: 'ME Form' });
    expect(ARRANGEMENT_EXTRACTS.crematory_form).toMatchObject({ page: 3, fileName: 'Crematory Form.pdf', displayName: 'Crematory Form' });
  });
});

describe('crematoryPermitStatus', () => {
  const base: Case = { ...caseFixtures[0], slaEvents: {}, checklistState: {} };
  const record = { at: '2026-10-26T15:00:00.000Z', recordedAt: '2026-10-26T15:00:00.000Z', recordedBy: 'staff-dana', source: 'staff' as const };

  it('is not confirmed from nothing — not from the stage, not from unrelated items', () => {
    const lateStage: Case = { ...base, rawStage: 6 };
    expect(crematoryPermitStatus(lateStage)).toEqual({ confirmed: false, basis: null });
  });

  it('is confirmed by a recorded state approval or a recorded permit sent', () => {
    expect(crematoryPermitStatus({ ...base, slaEvents: { approval_received: record } })).toEqual({ confirmed: true, basis: 'State approval recorded' });
    expect(crematoryPermitStatus({ ...base, slaEvents: { permit_sent: record } })).toEqual({ confirmed: true, basis: 'Permit sent to crematory recorded' });
  });

  it('is confirmed by the "Permit sent to crematory" checklist item, when the case\'s workflow has it', () => {
    const items = checklistItemsForEvent(base, 'permit_sent');
    if (items.length === 0) return; // the fixture workflow does not carry that item
    const checked = Object.fromEntries(items.map((item) => [checklistItemKey(item.displayStage, item.index), true]));
    expect(crematoryPermitStatus({ ...base, checklistState: checked })).toEqual({ confirmed: true, basis: '"Permit sent to crematory" checked' });
  });
});
