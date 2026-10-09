import { describe, expect, it } from 'vitest';
import {
  COMBINED_INTAKE_LABEL,
  canonicalDisplayStageToInspect,
  canonicalDisplayStagesForPresentedLabel,
  presentedStageLabels,
  presentedStages,
  presentsCombinedIntakeLabelsUppercase,
  toPresentedStageIndex,
} from './workflowStagePresentation';
import { STAGES } from '../cases/stages';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';

/**
 * Manors intake-stage combination (2026-10). `DEFAULT_ORGANIZATION_ID` is
 * 'managed-cremations' — the real Manors organization this overlay is
 * scoped to — so these exercise the real gate rather than a stand-in.
 *
 * The overlay is PRESENTATION ONLY. Nothing here asserts anything about
 * persisted state, because the overlay touches none: `Case.rawStage`,
 * every `StageTemplate.displayStage`, and every `checklistState`
 * composite key keep their canonical meaning. The checklist-key
 * protection this change depends on is asserted directly in
 * `domain/workflow/checklistItemKey.test.ts` and in the sibling
 * assertions at the bottom of this file.
 */

const GUS_LIKE_LABELS = ['Intake', 'Embalming', 'Service', 'Completed'] as const;

describe('presentedStages — Manors combines the two intake stages', () => {
  it('presents six user-facing stages instead of seven', () => {
    expect(presentedStageLabels(DEFAULT_ORGANIZATION_ID, STAGES)).toHaveLength(6);
    expect(STAGES).toHaveLength(7);
  });

  it('names the first stage "Intake & JotForm"', () => {
    expect(presentedStageLabels(DEFAULT_ORGANIZATION_ID, STAGES)[0]).toBe('Intake & JotForm');
    expect(COMBINED_INTAKE_LABEL).toBe('Intake & JotForm');
  });

  it('no longer exposes First Call & Payment or Jotform Application as independent user-facing stages', () => {
    const labels = presentedStageLabels(DEFAULT_ORGANIZATION_ID, STAGES);
    expect(labels).not.toContain('First Call & Payment');
    expect(labels).not.toContain('Jotform Application');
  });

  it('keeps every later stage, in order, with its label unchanged', () => {
    expect(presentedStageLabels(DEFAULT_ORGANIZATION_ID, STAGES)).toEqual([
      'Intake & JotForm',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'DC Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
  });

  it('keeps "Completed" terminal — last presented stage, and still the last canonical one', () => {
    const presented = presentedStages(DEFAULT_ORGANIZATION_ID, STAGES);
    const last = presented[presented.length - 1];
    expect(last.label).toBe('Completed');
    expect(last.canonicalDisplayStages).toEqual([STAGES.length - 1]);
  });

  it('records that the combined stage covers BOTH canonical intake display stages', () => {
    const [combined] = presentedStages(DEFAULT_ORGANIZATION_ID, STAGES);
    expect(combined.canonicalDisplayStages).toEqual([0, 1]);
  });

  it('covers every canonical display stage exactly once — no stage omitted, none counted twice', () => {
    const covered = presentedStages(DEFAULT_ORGANIZATION_ID, STAGES).flatMap((s) => s.canonicalDisplayStages);
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe('toPresentedStageIndex — existing persisted stages stay interpretable', () => {
  it('maps both canonical intake stages onto the one combined position', () => {
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 0, STAGES)).toBe(0);
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 1, STAGES)).toBe(0);
  });

  it('shifts every later canonical stage down by exactly one', () => {
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 2, STAGES)).toBe(1); // EDRS
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 3, STAGES)).toBe(2); // Permit
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 4, STAGES)).toBe(3); // DC Application
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 5, STAGES)).toBe(4); // Ready for Pickup
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 6, STAGES)).toBe(5); // Completed
  });

  it('is monotonic — a case can never appear to move backwards through the stepper', () => {
    const indices = [0, 1, 2, 3, 4, 5, 6].map((ds) => toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, ds, STAGES));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});

describe('canonicalDisplayStageToInspect — the two intake milestones stay separately reachable', () => {
  it('opens First Call when the case is in First Call', () => {
    expect(canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, 0, 0, STAGES)).toBe(0);
  });

  it('opens the Jotform Application checklist when the case is actually in it', () => {
    // The decisive assertion for "First Call completion cannot be mistaken
    // for Arrangement completion": a case sitting in canonical display
    // stage 1 inspects stage 1, so it reads key "1:0", never "0:0".
    expect(canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, 0, 1, STAGES)).toBe(1);
  });

  it('falls back to First Call once the case has moved past intake entirely', () => {
    expect(canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, 0, 4, STAGES)).toBe(0);
  });

  it('resolves a single-stage presented position to that canonical stage', () => {
    expect(canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, 1, 4, STAGES)).toBe(2); // EDRS
    expect(canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, 5, 4, STAGES)).toBe(6); // Completed
  });

  it('never returns a canonical stage outside the clicked presented group', () => {
    for (const presentedIndex of [0, 1, 2, 3, 4, 5]) {
      const group = presentedStages(DEFAULT_ORGANIZATION_ID, STAGES)[presentedIndex].canonicalDisplayStages;
      for (const current of [0, 1, 2, 3, 4, 5, 6]) {
        const inspected = canonicalDisplayStageToInspect(DEFAULT_ORGANIZATION_ID, presentedIndex, current, STAGES);
        expect(group).toContain(inspected);
      }
    }
  });
});

describe('canonicalDisplayStagesForPresentedLabel — stage routes stay compatible', () => {
  it('expands the combined label to both canonical intake stages', () => {
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'Intake & JotForm', STAGES)).toEqual([0, 1]);
  });

  it('still accepts the historical labels, so existing bookmarks keep working', () => {
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'First Call & Payment', STAGES)).toEqual([0]);
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'Jotform Application', STAGES)).toEqual([1]);
  });

  it('resolves every other canonical label unchanged', () => {
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'EDRS & Doctor / Cause of Death', STAGES)).toEqual([2]);
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'Completed', STAGES)).toEqual([6]);
  });

  it('returns null for a label that is not a stage at all', () => {
    expect(canonicalDisplayStagesForPresentedLabel(DEFAULT_ORGANIZATION_ID, 'Not A Stage', STAGES)).toBeNull();
  });
});

describe('multi-tenant isolation — only Manors is affected', () => {
  it('leaves another organization with the identity mapping, one presented stage per canonical stage', () => {
    const presented = presentedStages(SECOND_MOCK_ORGANIZATION_ID, GUS_LIKE_LABELS);
    expect(presented).toHaveLength(GUS_LIKE_LABELS.length);
    expect(presented.map((s) => s.label)).toEqual([...GUS_LIKE_LABELS]);
    expect(presented.every((s) => s.canonicalDisplayStages.length === 1)).toBe(true);
  });

  it('leaves another organization\'s stage indices untouched', () => {
    for (const ds of [0, 1, 2, 3]) {
      expect(toPresentedStageIndex(SECOND_MOCK_ORGANIZATION_ID, ds, GUS_LIKE_LABELS)).toBe(ds);
    }
  });

  it('does not combine another organization\'s stages even if it somehow used the Manors labels', () => {
    // Scoping is by organizationId, not by label text — so a second org
    // carrying identical labels is still left alone.
    expect(presentedStageLabels(SECOND_MOCK_ORGANIZATION_ID, STAGES)).toEqual([...STAGES]);
    expect(presentedStageLabels(SECOND_MOCK_ORGANIZATION_ID, STAGES)).toHaveLength(7);
  });

  it('no-ops for Manors if its template is ever restructured away from the two known intake labels', () => {
    // Fails safe: an unrecognized shape is passed through untouched rather
    // than relabelled into a stage the overlay no longer understands.
    const restructured = ['Intake', 'EDRS & Doctor / Cause of Death', 'Completed'];
    expect(presentedStageLabels(DEFAULT_ORGANIZATION_ID, restructured)).toEqual(restructured);
    expect(toPresentedStageIndex(DEFAULT_ORGANIZATION_ID, 2, restructured)).toBe(2);
  });

  it('no-ops when the two intake labels are present but not in the historical order', () => {
    const reordered = ['Jotform Application', 'First Call & Payment', 'Completed'];
    expect(presentedStageLabels(DEFAULT_ORGANIZATION_ID, reordered)).toEqual(reordered);
  });
});

describe('presentsCombinedIntakeLabelsUppercase — Manors Intake & JotForm label casing', () => {
  it('applies for Manors when the canonical intake stages are the expected pair', () => {
    expect(presentsCombinedIntakeLabelsUppercase(DEFAULT_ORGANIZATION_ID, STAGES)).toBe(true);
  });

  it('18. does NOT apply to another organization — their workflows render unchanged', () => {
    expect(presentsCombinedIntakeLabelsUppercase(SECOND_MOCK_ORGANIZATION_ID, STAGES)).toBe(false);
  });

  it('does not apply when the template has been restructured away from the expected pair', () => {
    // Same shape guard the stage combination uses: stop applying rather
    // than restyle a stage we no longer understand.
    expect(presentsCombinedIntakeLabelsUppercase(DEFAULT_ORGANIZATION_ID, ['Intake', 'Something Else'])).toBe(false);
    expect(presentsCombinedIntakeLabelsUppercase(DEFAULT_ORGANIZATION_ID, [])).toBe(false);
  });

  it('is keyed on the organization id, never a display name', () => {
    expect(presentsCombinedIntakeLabelsUppercase('Manors Cremation', STAGES)).toBe(false);
    expect(presentsCombinedIntakeLabelsUppercase('managed-cremations', STAGES)).toBe(true);
  });
});
