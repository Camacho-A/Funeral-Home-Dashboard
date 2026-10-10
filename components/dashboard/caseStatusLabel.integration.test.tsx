import { describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { AllCasesList } from './AllCasesList';
import { StageFilteredPanel } from './StageFilteredPanel';
import { buildCaseViewModel } from '../../domain/cases/viewModel';
import { latestTemplateVersion, buildCaseWorkflowSnapshot } from '../../domain/workflow/snapshot';
import { standardCremationWorkflowTemplateFixture } from '../../services/__mocks__/workflowTemplates';
import { DEFAULT_ORGANIZATION_ID } from '../../services/__mocks__/organizationIds';
import type { Case } from '../../types/case';

/**
 * Case status label (2026-10) — end-to-end.
 *
 * The unit tests either check what `buildCaseViewModel` computes, or what
 * the list renders for a given variant. This file joins the two: a real
 * `Case` goes through the real view model into the real list component, and
 * the assertion is the text a staff member actually sees under the case
 * number. That is what makes "a released case reads Completed in the list"
 * a verified fact rather than two separately-true halves.
 *
 * Written because this change could not be verified in a browser — the
 * mock-mode dev server's portal shell would not stay loaded long enough to
 * reach the case list.
 */

function caseWith(overrides: Partial<Case>): Case {
  const template = standardCremationWorkflowTemplateFixture;
  const version = latestTemplateVersion(template);
  return {
    id: '1042',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseNumber: 'B2026-035',
    decedentName: 'Evarista Silva Rivero',
    dateOfBirth: '—',
    dateOfDeath: '—',
    timeOfDeath: '—',
    placeOfDeath: '—',
    weight: '—',
    rawStage: 0,
    assignedStaffId: null,
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinEmail: null,
    nextOfKinRelationship: null,
    nextOfKinRelationshipOther: null,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    tagNumber: null,
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: 'undecided',
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    paymentStatus: 'awaiting_payment',
    isVeteran: false,
    vaStepsState: {},
    vaCallbackDone: false,
    vaPublishChoice: null,
    vaNotificationResponsibility: null,
    caseType: 'cremation',
    checklistState: {},
    fieldValues: {},
    daysWaitingInStage: 1,
    isStalled: false,
    stalledReason: null,
    isDeleted: false,
    createdAt: '2026-07-09T00:00:00.000Z',
    createdBy: 'staff-dana',
    intakeOwnerId: 'staff-dana',
    workflowTemplateId: template.id,
    workflowTemplateVersion: version,
    workflowSnapshot: buildCaseWorkflowSnapshot(template, version),
    ...overrides,
  } as Case;
}

/** The exact text a staff member sees under the case number, in each list. */
function statusTextsFor(case_: Case) {
  const vm = buildCaseViewModel(case_, { staffList: [] });
  const row = {
    id: vm.id,
    caseNumber: vm.caseNumber,
    decedentName: vm.decedentName,
    decedentInitials: vm.decedentInitials,
    rowSummaryText: vm.rowSummaryText,
    rowSummaryVariant: vm.rowSummaryVariant,
    isOverdue: vm.isOverdue,
    stageLabel: vm.stageLabel,
    stageBadgeVariant: vm.stageBadgeVariant,
    progressPercent: vm.progressPercent,
  };

  const all = render(
    <AllCasesList
      cases={[row]}
      emptyMessage="No cases found."
      hasMore={false}
      isLoadingMore={false}
      onLoadMore={vi.fn()}
    />,
  );
  // Scoped by class: on a finished case the stage badge ALSO reads
  // "Completed", so matching on text alone is ambiguous. The status line
  // under the case number is the .summary element.
  const allCasesEl = within(all.container).getByText(
    vm.rowSummaryText,
    { selector: '[class*="summary"]' },
  );
  const allCases = { text: allCasesEl.textContent ?? '', className: allCasesEl.className };
  all.unmount();

  const stage = render(
    <StageFilteredPanel
      cases={[{ ...row, isStalled: case_.isStalled, selected: false }]}
      emptyMessage="No cases in this stage."
      selectedCount={0}
      onToggleSelect={vi.fn()}
      onAdvance={vi.fn()}
      hasMore={false}
      isLoadingMore={false}
      onLoadMore={vi.fn()}
    />,
  );
  const stageEl = within(stage.container).getByText(
    vm.rowSummaryText,
    { selector: '[class*="summary"]' },
  );
  const stagePanel = { text: stageEl.textContent ?? '', className: stageEl.className };
  stage.unmount();

  return { allCases, stagePanel };
}

describe('case status label — real Case through the real list (2026-10)', () => {
  it('a case still in progress shows its next action, not "Completed"', () => {
    const { allCases, stagePanel } = statusTextsFor(caseWith({ rawStage: 3 }));
    expect(allCases.text).toBe('EDRS submitted & sent to doctor');
    expect(allCases.className).toMatch(/summaryNeutral/);
    expect(stagePanel.text).toBe(allCases.text);
  });

  it('a terminal-stage case awaiting family pickup names what is outstanding, and is not Completed', () => {
    // The family has not collected the remains yet, so the row names the
    // one thing left rather than claiming completion. (It reads the item's
    // own label here; the bare "Review case" fallback only appears when a
    // stage has no undone item at all.)
    const { allCases } = statusTextsFor(
      caseWith({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'awaiting_pickup' }),
    );
    expect(allCases.text).toBe('Family picked up ashes');
    expect(allCases.text).not.toBe('Completed');
    expect(allCases.className).toMatch(/summaryNeutral/);
  });

  it('recording the family pickup makes the list read "Completed" in green', () => {
    const { allCases, stagePanel } = statusTextsFor(
      caseWith({
        rawStage: 7,
        returnMethod: 'pickup',
        pickupStatus: 'released',
        pickupReleasedTo: 'KAREN ELLISON',
        pickupReleasedAt: '10/09/2026',
      }),
    );
    expect(allCases.text).toBe('Completed');
    expect(allCases.className).toMatch(/summaryComplete/);
    // Both lists, identically.
    expect(stagePanel.text).toBe('Completed');
    expect(stagePanel.className).toMatch(/summaryComplete/);
  });

  it('confirmed shipping delivery reads "Completed"; dispatch alone does not', () => {
    expect(
      statusTextsFor(caseWith({ rawStage: 7, returnMethod: 'shipping', shippingDeliveryStatus: 'shipped' })).allCases
        .text,
    ).not.toBe('Completed');

    const delivered = statusTextsFor(
      caseWith({ rawStage: 7, returnMethod: 'shipping', shippingDeliveryStatus: 'delivered' }),
    );
    expect(delivered.allCases.text).toBe('Completed');
    expect(delivered.allCases.className).toMatch(/summaryComplete/);
  });

  it('an archived case reads "Archived" in the muted style', () => {
    const { allCases, stagePanel } = statusTextsFor(caseWith({ rawStage: 7, isDeleted: true }));
    expect(allCases.text).toBe('Archived');
    expect(allCases.className).toMatch(/summaryArchived/);
    expect(stagePanel.className).toMatch(/summaryArchived/);
  });

  it('a legacy case carrying pre-migration checklist keys renders a status and is not Completed', () => {
    // Legacy rows store `checklistState` under bare indices rather than
    // the composite "{displayStage}:{index}" keys, and predate the
    // contact/return columns. Such a case must still render a sensible
    // status — and must not read Completed, since completion comes from
    // the release record, never from stored checklist state.
    const { allCases } = statusTextsFor(
      caseWith({ rawStage: 7, returnMethod: 'pickup', pickupStatus: 'awaiting_pickup', checklistState: { 0: true, 1: true } }),
    );
    expect(allCases.text.length).toBeGreaterThan(0);
    expect(allCases.text).not.toBe('Completed');
  });

  it('a stalled, incomplete case still shows its blocker in red', () => {
    const { allCases } = statusTextsFor(
      caseWith({ rawStage: 3, isStalled: true, stalledReason: 'Waiting on ME release' }),
    );
    expect(allCases.text).toBe('Waiting on ME release');
    expect(allCases.className).toMatch(/summaryDanger/);
  });
});
