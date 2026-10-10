'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useCase } from '@/hooks/useCase';
import { useResetMainContentScrollOnChange } from '@/hooks/useResetMainContentScrollOnChange';
import { useCaseViewModel } from '@/hooks/useCaseViewModel';
import { useCaseMutations } from '@/hooks/useCaseMutations';
import { useCaseLog } from '@/hooks/useCaseLog';
import { useCaseTasks } from '@/hooks/useCaseTasks';
import { useStaff } from '@/hooks/useStaff';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { isFamilyPortalEnabled } from '@/domain/organization/familyPortalCapability';
import { shouldShowCaseOwner } from '@/domain/organization/caseOwnerVisibility';
import { defaultAssigneeForCase } from '@/domain/tasks/rules';
import { printTextLog } from '@/utils/print';
import { formatTimestamp } from '@/utils/format';
import { CaseHeader } from '@/components/case/CaseHeader';
import type { StepperStage } from '@/components/case/StageStepper';
import { CaseInformationCard } from '@/components/case/CaseInformationCard';
import { CaseWorkflowRepairPanel } from '@/components/case/CaseWorkflowRepairPanel';
import { WorkflowStageOverview } from '@/components/case/WorkflowStageOverview';
import { CaseOrderCard } from '@/components/case/CaseOrderCard';
import { BillingCard } from '@/components/case/BillingCard';
import { ChecklistCard } from '@/components/case/ChecklistCard';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useArchiveCase } from '@/hooks/useArchiveCase';
import { CaseLogCard } from '@/components/case/CaseLogCard';
import { CaseTasksCard, type CaseTaskItem } from '@/components/case/CaseTasksCard';
import { CaseActivityTab } from '@/components/case/CaseActivityTab';
import { CaseDocumentsTab } from '@/components/case/CaseDocumentsTab';
import { CaseScheduleTab } from '@/components/case/CaseScheduleTab';
import { CaseFamilyPortalTab } from '@/components/case/CaseFamilyPortalTab';
import styles from './page.module.css';

type CaseDetailTab = 'overview' | 'caseInfo' | 'workflow' | 'billing' | 'documents' | 'activity' | 'schedule' | 'portal';

/**
 * Case Detail page — the orchestration layer. `params` is a Promise per
 * Next.js 15's Client Component convention (unwrapped with React's `use`).
 *
 * SOLIS Phase 3 (presentation only): the Overview tab is a two-column
 * workspace — main column (Checklist → Case Log + Tasks → Case Order) and a
 * sticky right rail (Case Information). Every component receives EXACTLY
 * the same props as before; only their position in the tree changed.
 * CaseHeader additionally receives the existing weight/weightOver200 view-
 * model values for its facts line. Tabs, permission gates, mutations,
 * hooks, and routing are unchanged.
 *
 * Compact stage progress (supersedes the full-width <StageStepper> row):
 * the same `stepperStages`/`onStepClick` the old stepper used are now
 * passed into CaseHeader, which renders the compact <StageProgress>
 * popover under the stage chip instead. StageStepper.tsx itself is
 * untouched and still exported for any other future caller — it's simply
 * no longer rendered on this page.
 */
export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const [viewingDisplayStage, setViewingDisplayStage] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<CaseDetailTab>('overview');

  /**
   * Case Info tab (2026-10). 560px is the SAME breakpoint
   * page.module.css uses to turn `.tabs` into the stacked mobile
   * segmented control — deliberately not 1024px (where `.overview`
   * collapses to a single column). Below 1024px the rail already stacks
   * BELOW the main column and stays fully visible, so Case Information
   * is never missing at any tablet width; the tab appears only where a
   * mobile tab bar actually exists.
   *
   * `useMediaQuery` reports false until mounted (SSR-safe — see its own
   * comment), so first paint is the desktop layout and the client
   * corrects on mount. Same pattern the Calendar page already uses.
   */
  const isMobileTabs = useMediaQuery('(max-width: 560px)');
  const archiveCase = useArchiveCase();

  // Widening back to a size where Case Info is not a tab must not strand
  // the page on a tab that no longer exists (which would render nothing).
  // Only this tab is reset; every other selection is preserved.
  useEffect(() => {
    if (!isMobileTabs && activeTab === 'caseInfo') setActiveTab('overview');
  }, [isMobileTabs, activeTab]);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const activeButton = tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  useResetMainContentScrollOnChange(caseId);

  const { data: case_, isPending } = useCase(caseId);
  const { data: staffList = [] } = useStaff();
  const { data: organizationRecord } = useOrganizationRecord();
  const familyPortalEnabled = isFamilyPortalEnabled(organizationRecord ?? null);
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canSeeWorkflowTab = Boolean(permissionsQuery.data?.permissions.includes('user.manageRoles'));
  const canSeeBillingTab = Boolean(permissionsQuery.data?.permissions.includes('payment.read'));
  const viewModel = useCaseViewModel(case_, viewingDisplayStage);
  const mutations = useCaseMutations(caseId);
  const caseLog = useCaseLog(caseId);
  const caseTasks = useCaseTasks(caseId);

  if (isPending) return <p className={styles.loading}>Loading case…</p>;

  if (case_ === null) {
    throw new Error(`Case ${caseId} not found for this organization`);
  }
  if (!case_ || !viewModel) return null;

  // Manors intake-stage combination (2026-10): `stageLabels` is the
  // USER-FACING list and may be shorter than the canonical display-stage
  // count, so every comparison here uses `presentedDisplayStage`. Clicking
  // a step still opens a CANONICAL display stage's checklist — resolved by
  // `canonicalDisplayStageToInspect`, so checklist lookup and composite
  // checklist keys are completely unchanged. See
  // domain/organization/workflowStagePresentation.ts.
  const stepperStages: StepperStage[] = viewModel.stageLabels.map((label, index) => ({
    label,
    done: index < viewModel.presentedDisplayStage,
    current: index === viewModel.presentedDisplayStage,
    viewable: index <= viewModel.presentedDisplayStage,
  }));

  // A presented stage can cover more than one canonical display stage
  // (Manors' combined intake). Open the case's OWN canonical stage when it
  // sits inside the clicked group — so a case in "Jotform Application"
  // opens its real live checklist — otherwise the group's first canonical
  // stage, which carries the substantive intake items.
  function viewPresentedStage(presentedIndex: number) {
    const group = viewModel!.canonicalDisplayStagesByPresentedIndex[presentedIndex] ?? [presentedIndex];
    const canonical = group.includes(viewModel!.displayStage) ? viewModel!.displayStage : group[0];
    setViewingDisplayStage(canonical === viewModel!.displayStage ? null : canonical);
  }

  const staffOptions = staffList.map((staff) => ({ id: staff.id, name: staff.displayName }));

  const logEntries = [...(caseLog.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const caseLinkedTasks = caseTasks.data ?? [];

  const caseTaskItems: CaseTaskItem[] = caseLinkedTasks.map((task) => ({
    id: task.id,
    text: task.text,
    isDone: task.isDone,
    assigneeName:
      staffList.find((staff) => staff.id === task.assigneeStaffId)?.displayName ?? 'Office',
  }));

  /**
   * Defined ONCE and rendered in exactly one place at a time — the
   * desktop/tablet rail or the mobile Case Info tab, never both. Keeping
   * a single element (rather than repeating the JSX in two branches) is
   * what guarantees no duplicate rendering, no second copy of the card's
   * internal edit state, and no duplicated content for screen readers.
   */
  const caseInformationPanel = (
          <CaseInformationCard
            dateOfBirth={viewModel.dateOfBirth}
            dateOfDeath={viewModel.dateOfDeath}
            timeOfDeath={viewModel.timeOfDeath}
            placeOfDeath={viewModel.placeOfDeath}
            weight={viewModel.weight}
            weightOver200={viewModel.weightOver200}
            nextOfKinName={case_.nextOfKinName}
            nextOfKinPhone={case_.nextOfKinPhone}
            nextOfKinEmail={case_.nextOfKinEmail}
            nextOfKinRelationship={case_.nextOfKinRelationship}
            nextOfKinRelationshipOther={case_.nextOfKinRelationshipOther}
            doNotContactNextOfKin={case_.doNotContactNextOfKin}
            arrangementContactName={case_.arrangementContactName}
            arrangementContactRelationship={case_.arrangementContactRelationship}
            arrangementContactPhone={case_.arrangementContactPhone}
            arrangementContactEmail={case_.arrangementContactEmail}
            contactInstructions={case_.contactInstructions}
            arrangementAuthorizationConfirmed={case_.arrangementAuthorizationConfirmed}
            arrangementAuthorizationSource={case_.arrangementAuthorizationSource}
            isArchived={case_.isDeleted}
            caseNumber={viewModel.caseNumber}
            decedentName={viewModel.decedentName}
            onArchiveChange={(archived) => archiveCase.mutate({ caseId, archived })}
            archivePending={archiveCase.isPending}
            certifierName={case_.certifierName}
            certifierPhone={case_.certifierPhone}
            certifierLicenseNumber={case_.certifierLicenseNumber}
            certifierFax={case_.certifierFax}
            onSaveCertifierName={(value) => mutations.setCertifierName(case_, value)}
            onSaveCertifierPhone={(value) => mutations.setCertifierPhone(case_, value)}
            onSaveCertifierLicenseNumber={(value) => mutations.setCertifierLicenseNumber(case_, value)}
            onSaveCertifierFax={(value) => mutations.setCertifierFax(case_, value)}
            tagNumber={case_.tagNumber}
            paymentStatus={viewModel.paymentStatus}
            pickupStatus={case_.pickupStatus}
            pickupReleasedTo={case_.pickupReleasedTo}
            pickupReleasedAt={case_.pickupReleasedAt}
            pickupNote={case_.pickupNote}
            returnMethod={case_.returnMethod}
            shippingCarrier={case_.shippingCarrier}
            shippingTrackingNumber={case_.shippingTrackingNumber}
            shippingDateShipped={case_.shippingDateShipped}
            shippingDeliveryStatus={case_.shippingDeliveryStatus}
            shippingDeliveredAt={case_.shippingDeliveredAt}
            ownerStaffId={viewModel.ownerStaffId}
            staffOptions={staffOptions}
            onReassignOwner={(staffId) => mutations.reassignOwner(staffId)}
            showOwner={shouldShowCaseOwner(organizationId)}
            onUpdateCaseInfo={(patch) => mutations.updateCaseInfo(patch)}
            onSaveWeight={(value) => mutations.setWeight(case_, value)}
            onSaveTimeOfDeath={(value) => mutations.setTimeOfDeath(case_, value)}
            isVeteran={viewModel.isVeteran}
            veteranFlagLocked={viewModel.veteranFlagLocked}
            onToggleVeteran={(newValue) => mutations.setVeteranFlag(newValue)}
            vaSteps={viewModel.vaSteps}
            vaCallbackDone={viewModel.vaCallbackDone}
            vaPublishChoice={viewModel.vaPublishChoice}
            vaNotificationResponsibility={viewModel.vaNotificationResponsibility}
            onToggleVaStep={(index, newDone) => mutations.toggleVaStep(case_, index, newDone)}
            onSetVaPublishChoice={(choice) => mutations.setVaPublishChoice(choice)}
            onSetVaNotificationResponsibility={(responsibility) => mutations.setVaNotificationResponsibility(responsibility)}
          />
  );

  return (
    <div>
      <CaseHeader
        caseNumber={viewModel.caseNumber}
        decedentName={viewModel.decedentName}
        dateOfBirth={viewModel.dateOfBirth}
        dateOfDeath={viewModel.dateOfDeath}
        tagNumber={case_.tagNumber}
        weight={viewModel.weight}
        weightOver200={viewModel.weightOver200}
        caseDetailStageHeading={viewModel.caseDetailStageHeading}
        stageBadgeVariant={viewModel.stageBadgeVariant}
        daysWaitingInStage={viewModel.daysWaitingInStage}
        slaTargetLabel={viewModel.slaTargetLabel}
        isOverdue={viewModel.isOverdue}
        stages={stepperStages}
        onStepClick={(index) => viewPresentedStage(index)}
      />

      <div className={styles.tabs} role="tablist" ref={tabsRef}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={activeTab === 'overview' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        {/* Mobile only: above 560px Case Information lives in the overview
            rail, so adding a tab there would duplicate it. */}
        {isMobileTabs && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'caseInfo'}
            className={activeTab === 'caseInfo' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('caseInfo')}
          >
            Case Info
          </button>
        )}
        {canSeeWorkflowTab && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workflow'}
            className={activeTab === 'workflow' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('workflow')}
          >
            Workflow
          </button>
        )}
        {canSeeBillingTab && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'billing'}
            className={activeTab === 'billing' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('billing')}
          >
            Billing
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'documents'}
          className={activeTab === 'documents' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('documents')}
        >
          Documents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'activity'}
          className={activeTab === 'activity' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('activity')}
        >
          Activity
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'schedule'}
          className={activeTab === 'schedule' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('schedule')}
        >
          Schedule
        </button>
        {familyPortalEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'portal'}
            className={activeTab === 'portal' ? styles.tabActive : styles.tabInactive}
            onClick={() => setActiveTab('portal')}
          >
            Family Portal
          </button>
        )}
      </div>

      {activeTab === 'workflow' && canSeeWorkflowTab && (
        <>
          <WorkflowStageOverview
            stages={stepperStages}
            daysWaitingInStage={viewModel.daysWaitingInStage}
            slaTargetLabel={viewModel.slaTargetLabel}
            currentChecklist={viewModel.checklist.map((item) => ({ label: item.label, done: item.done }))}
            onViewStage={(index) => {
              viewPresentedStage(index);
              setActiveTab('overview');
            }}
          />
          <CaseWorkflowRepairPanel caseId={caseId} />
        </>
      )}
      {activeTab === 'billing' && canSeeBillingTab && <BillingCard caseId={caseId} />}
      {activeTab === 'documents' && (
        <CaseDocumentsTab caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />
      )}
      {activeTab === 'activity' && (
        <CaseActivityTab caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />
      )}
      {activeTab === 'caseInfo' && isMobileTabs && (
        <section className={styles.caseInfoTab} aria-label="Case details">
          {caseInformationPanel}
        </section>
      )}
      {activeTab === 'schedule' && <CaseScheduleTab caseId={caseId} />}
      {activeTab === 'portal' && familyPortalEnabled && <CaseFamilyPortalTab caseId={caseId} />}

      {activeTab === 'overview' && (
        <div className={styles.overview}>
          <div className={styles.overviewMain}>
            <section aria-label="Next step">
              <div className={styles.eyebrow}>Next step</div>
              <ChecklistCard
                checklist={viewModel.checklist}
                viewingStageLabel={
                  viewingDisplayStage != null
                    ? (viewModel.stageLabels[
                        viewModel.canonicalDisplayStagesByPresentedIndex.findIndex((group) =>
                          group.includes(viewingDisplayStage),
                        )
                      ] ?? null)
                    : null
                }
                onBackToCurrentStage={() => setViewingDisplayStage(null)}
                onToggleItem={(index, newDone) => mutations.toggleChecklistItem(case_, index, newDone)}
                onFieldChange={(index, value) => mutations.setFieldValue(case_, index, value)}
                onSaveCertifierName={(value) => mutations.setCertifierName(case_, value)}
                onSaveCertifierPhone={(value) => mutations.setCertifierPhone(case_, value)}
                onUpdateCaseInfo={(patch) => mutations.updateCaseInfo(patch)}
                contactRestriction={{
                  active: case_.doNotContactNextOfKin === true,
                  arrangementContactName: case_.arrangementContactName ?? null,
                }}
              />
            </section>

            <div className={styles.overviewPair}>
              <CaseLogCard
                entries={logEntries}
                onAddEntry={(input, options) => caseLog.addEntry(input, options)}
                onPrint={() =>
                  printTextLog('Case Log', viewModel.decedentName, viewModel.caseNumber, logEntries, (entry) => {
                    const headline =
                      entry.type === 'contact'
                        ? `<div style="font-weight:600">Called ${entry.contactedWho} — spoke with ${entry.contactedSpoke}</div>`
                        : '';
                    const body = entry.type === 'contact' ? entry.contactSummary : entry.text;
                    return `<div style="margin-bottom:12px">${headline}${body ? `<div>${body}</div>` : ''}<div style="font-size:12px;color:#888">${entry.author} · ${formatTimestamp(entry.createdAt)}</div></div>`;
                  })
                }
              />

              <CaseTasksCard
                tasks={caseTaskItems}
                onToggleTask={(taskId, newDone) => caseTasks.toggleTask({ taskId, isDone: newDone })}
                onAddTask={(text) =>
                  caseTasks.addTask({
                    text,
                    assigneeStaffId: defaultAssigneeForCase(case_, staffList),
                  })
                }
              />
            </div>

            <CaseOrderCard caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />
          </div>

          {!isMobileTabs && (
            <aside className={styles.overviewRail} aria-label="Case details">
              {caseInformationPanel}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
