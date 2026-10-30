'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { officialDocumentsFor } from '@/domain/documents/officialDocumentTriggers';
import { CaseSlaPanel } from '@/components/case/CaseSlaPanel';
import { useCase } from '@/hooks/useCase';
import { Button } from '@/components/ui/Button';
import { StalledLoading } from '@/components/ui/StalledLoading';
import { useResetMainContentScrollOnChange } from '@/hooks/useResetMainContentScrollOnChange';
import { useCaseViewModel } from '@/hooks/useCaseViewModel';
import { useCaseMutations } from '@/hooks/useCaseMutations';
import { useCaseLog } from '@/hooks/useCaseLog';
import { useCaseTasks } from '@/hooks/useCaseTasks';
import { useStaff } from '@/hooks/useStaff';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCaseOrder } from '@/hooks/useCaseOrder';
import { useCasePayments } from '@/hooks/useCasePayments';
import { summarizeCasePayment } from '@/domain/cases/casePaymentSummary';
import { isFamilyPortalEnabled } from '@/domain/organization/familyPortalCapability';
import { shouldShowCaseOwner } from '@/domain/organization/caseOwnerVisibility';
import { defaultAssigneeForCase } from '@/domain/tasks/rules';
import { printTextLog } from '@/utils/print';
import { formatTimestamp } from '@/utils/format';
import { caseLogEntryDisplay } from '@/domain/cases/caseLogDisplay';
import { escapeHtml } from '@/domain/billing/renderUtil';
import { CaseHeader } from '@/components/case/CaseHeader';
import { PrintLabelDialog } from '@/components/case/PrintLabelDialog';
import { SendToCrematoryDialog } from '@/components/crematory/SendToCrematoryDialog';
import { sendToCrematoryConfig } from '@/domain/crematory/crematorySettings';
import { workflowStageToOpen } from '@/domain/workflow/workflowStageToOpen';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import type { StepperStage } from '@/components/case/StageStepper';
import { CaseInformationCard } from '@/components/case/CaseInformationCard';
import { CaseEditConflictBanner } from '@/components/case/CaseEditConflictBanner';
import { CaseWorkflowRepairPanel } from '@/components/case/CaseWorkflowRepairPanel';
import { WorkflowStageOverview } from '@/components/case/WorkflowStageOverview';
import { CaseOrderCard } from '@/components/case/CaseOrderCard';
import { BillingCard } from '@/components/case/BillingCard';
import { ChecklistCard, hasVisibleChecklistItems } from '@/components/case/ChecklistCard';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useArchiveCase } from '@/hooks/useArchiveCase';
import { CaseLogCard } from '@/components/case/CaseLogCard';
import { CaseTasksCard, type CaseTaskItem } from '@/components/case/CaseTasksCard';
import { CaseActivityTab } from '@/components/case/CaseActivityTab';
import { CaseDocumentsTab } from '@/components/case/CaseDocumentsTab';
import { CaseScheduleTab } from '@/components/case/CaseScheduleTab';
import { CaseFamilyPortalTab } from '@/components/case/CaseFamilyPortalTab';
import styles from './page.module.css';
import { CaseSsnField } from '@/components/case/CaseSsnField';

/** Intake is the first step of every workflow — named here rather than
    written as a bare 0 at the use site. */
const INTAKE_PRESENTED_STAGE_INDEX = 0;

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
  /** Resolve Workflow 2 (2026-10): open a workflow stage's checklist and bring it into view. */
  const nextStepRef = useRef<HTMLElement>(null);
  const [revealNextStep, setRevealNextStep] = useState(0);
  const router = useRouter();
  const requestedWorkflowStage = useSearchParams().get('workflowStage');
  const [activeTab, setActiveTab] = useState<CaseDetailTab>('overview');
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  const [sendToCrematoryOpen, setSendToCrematoryOpen] = useState(false);

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

  const { data: case_, isPending, isError: caseFailed, refetch: refetchCase } = useCase(caseId);
  const { data: staffList = [] } = useStaff();
  const { data: organizationRecord } = useOrganizationRecord();
  const familyPortalEnabled = isFamilyPortalEnabled(organizationRecord ?? null);
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canSeeWorkflowTab = Boolean(permissionsQuery.data?.permissions.includes('user.manageRoles'));
  const canSeeBillingTab = Boolean(permissionsQuery.data?.permissions.includes('payment.read'));
  // The derived payment status beside the stored "Payment" value (2026-10):
  // the same order/payment queries the Case Order card reads, under the
  // same permissions — nothing is fetched that the viewer could not see.
  const canReadCaseOrder = Boolean(permissionsQuery.data?.permissions.includes('caseOrder.read'));
  const { data: caseOrder } = useCaseOrder(caseId, canReadCaseOrder);
  const { data: casePayments } = useCasePayments(caseId, canReadCaseOrder && canSeeBillingTab);
  const viewModel = useCaseViewModel(case_, viewingDisplayStage);
  const mutations = useCaseMutations(caseId);
  const caseLog = useCaseLog(caseId);
  const caseTasks = useCaseTasks(caseId);

  // Opens a workflow stage the case has reached (a later one opens the
  // case's current step instead). Changes nothing on the case.
  function openWorkflowStage(displayStage: number | string) {
    if (!viewModel) return;
    setSendToCrematoryOpen(false);
    setActiveTab('overview');
    setViewingDisplayStage(workflowStageToOpen(displayStage, viewModel.displayStage));
    setRevealNextStep((n) => n + 1);
  }
  useEffect(() => {
    if (revealNextStep > 0) nextStepRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [revealNextStep]);
  // From Send to Crematory on the Cases page: /cases/[id]?workflowStage=2.
  useEffect(() => {
    if (!requestedWorkflowStage || !viewModel || !case_) return;
    if (sendToCrematoryConfig(case_.organizationId)) openWorkflowStage(requestedWorkflowStage);
    router.replace(`/cases/${encodeURIComponent(caseId)}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request, when the case has loaded
  }, [requestedWorkflowStage, viewModel === null]);

  // Keeps the stalled-loading watchdog where it still matters: this is
  // the case page's OWN pending state, not a route-level Suspense shell.
  if (isPending) return <StalledLoading label="Loading case…" />;

  /**
   * A case that failed to load says so, and offers a way to try again
   * (2026-10). Previously this fell through to `return null` below and
   * rendered a blank screen: the case looked like it held nothing, which
   * for a funeral director reads as lost data rather than a failed
   * request. Nothing here is a judgement about the case itself — only
   * about whether this browser managed to fetch it.
   */
  if (caseFailed) {
    return (
      <div className={styles.loadFailure} role="alert">
        <p className={styles.loadFailureTitle}>This case couldn&rsquo;t be loaded.</p>
        <p className={styles.loadFailureBody}>
          Nothing has been changed. Check your connection and try again.
        </p>
        <Button variant="secondary" onClick={() => void refetchCase()}>
          Retry
        </Button>
      </div>
    );
  }

  if (case_ === null) {
    throw new Error(`Case ${caseId} not found for this organization`);
  }
  if (!case_ || !viewModel) return null;

  /**
   * Which presented step the checklist below is currently showing — the
   * stage being inspected when one is, otherwise the case's own current
   * stage. Presented indices, not canonical display stages, because this
   * is about which step staff are looking at.
   */
  const shownPresentedStageIndex =
    viewingDisplayStage != null
      ? viewModel.canonicalDisplayStagesByPresentedIndex.findIndex((group) => group.includes(viewingDisplayStage))
      : viewModel.presentedDisplayStage;

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
    // True earlier-stage status (2026-10, Manors only — empty elsewhere):
    // the required steps still unchecked across the stage's canonical group.
    incompleteSteps:
      index < viewModel.presentedDisplayStage
        ? (viewModel.canonicalDisplayStagesByPresentedIndex[index] ?? [index]).reduce(
            (sum, canonical) => sum + (viewModel.earlierStageUncheckedSteps[canonical] ?? 0),
            0,
          )
        : 0,
  }));

  // A presented stage can cover more than one canonical display stage
  // (Manors' combined intake). Open the case's OWN canonical stage when it
  // sits inside the clicked group — so a case in "Jotform Application"
  // opens its real live checklist — otherwise the group's first canonical
  // stage, which carries the substantive intake items.
  function viewPresentedStage(presentedIndex: number) {
    const group = viewModel!.canonicalDisplayStagesByPresentedIndex[presentedIndex] ?? [presentedIndex];
    // An earlier group with steps not checked opens the first stage that has them.
    const firstUnchecked = group.find((stage) => (viewModel!.earlierStageUncheckedSteps[stage] ?? 0) > 0);
    const canonical = group.includes(viewModel!.displayStage) ? viewModel!.displayStage : (firstUnchecked ?? group[0]);
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
            decedentMiddleName={case_.decedentMiddleName}
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
            ssnField={
              getRegisteredOrganizationProfile(organizationId).features.caseSsn ? (
                <CaseSsnField organizationId={organizationId} caseId={case_.id} ssnOnFile={case_.ssnOnFile} readOnly={case_.isDeleted === true} />
              ) : undefined
            }
            isMedicalExaminerCase={case_.isMedicalExaminerCase === true}
            caseNumber={viewModel.caseNumber}
            // The RAW stored name, not the composed one: this card edits it,
            // and composes for display itself. Passing the composed name
            // would bake the middle name into `decedentName` on save.
            decedentName={case_.decedentName}
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
            dateOfCremation={case_.dateOfCremation ?? null}
            showDateOfCremation={officialDocumentsFor(case_.organizationId).includes('certificate_of_cremation')}
            paymentStatus={viewModel.paymentStatus}
            paymentSummary={
              canReadCaseOrder && canSeeBillingTab ? summarizeCasePayment({ order: caseOrder?.order, payments: casePayments, recordedStatus: viewModel.paymentStatus }) : null
            }
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
        isMedicalExaminerCase={case_.isMedicalExaminerCase === true}
        isArchived={case_.isDeleted === true}
        caseDetailStageHeading={viewModel.caseDetailStageHeading}
        stageBadgeVariant={viewModel.stageBadgeVariant}
        daysWaitingInStage={viewModel.daysWaitingInStage}
        slaTargetLabel={viewModel.slaTargetLabel}
        isOverdue={viewModel.isOverdue}
        stages={stepperStages}
        onStepClick={(index) => viewPresentedStage(index)}
        sla={viewModel.sla}
        actions={
          getRegisteredOrganizationProfile(organizationId).features.dymoCaseLabel || (sendToCrematoryConfig(organizationId) && case_.caseType === 'cremation') ? (
            <>
              {getRegisteredOrganizationProfile(organizationId).features.dymoCaseLabel && (
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setPrintLabelOpen(true)}>
                  Print Label
                </button>
              )}
              {sendToCrematoryConfig(organizationId) && case_.caseType === 'cremation' && (
                <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setSendToCrematoryOpen(true)}>
                  Send to Crematory
                </button>
              )}
            </>
          ) : undefined
        }
      />
      {sendToCrematoryOpen && (
        <SendToCrematoryDialog open onClose={() => setSendToCrematoryOpen(false)} organizationId={organizationId} caseId={case_.id} onResolveWorkflow={(_id, stage) => openWorkflowStage(stage)} />
      )}
      {printLabelOpen && (
        <PrintLabelDialog open onClose={() => setPrintLabelOpen(false)} caseId={case_.id} organizationId={organizationId} />
      )}

      {/* SLA tracking (2026-10): details collapsed under the header. */}
      {viewModel.sla?.enabled && (
        <CaseSlaPanel
          case_={case_}
          sla={viewModel.sla}
          organizationId={organizationId}
          // Same convention as the Schedule tab: unknown permissions show the
          // controls and the server decides (the SLA route checks case edit).
          canEdit={!permissionsQuery.isSuccess || permissionsQuery.data.permissions.includes('case.update')}
        />
      )}

      {/* Case concurrency (2026-10): a save refused because the case changed
          since this page loaded it. See hooks/useCaseMutations.ts. */}
      {mutations.conflict && (
        <CaseEditConflictBanner onRefresh={() => mutations.refreshAfterConflict()} onRetry={() => mutations.retryAfterConflict()} />
      )}
      {archiveCase.error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {archiveCase.error.message}
        </div>
      )}

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
            {(viewingDisplayStage != null || hasVisibleChecklistItems(viewModel.checklist)) && (
            <section aria-label="Next step" ref={nextStepRef}>
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
                onToggleItem={(index, newDone) => mutations.toggleChecklistItem(case_, index, newDone, viewingDisplayStage)}
                onFieldChange={(index, value) => mutations.setFieldValue(case_, index, value)}
                onSaveCertifierName={(value) => mutations.setCertifierName(case_, value)}
                onSaveCertifierPhone={(value) => mutations.setCertifierPhone(case_, value)}
                onUpdateCaseInfo={(patch) => mutations.updateCaseInfo(patch)}
                contactRestriction={{
                  active: case_.doNotContactNextOfKin === true,
                  arrangementContactName: case_.arrangementContactName ?? null,
                }}
                isArchived={case_.isDeleted === true}
                canEdit={!permissionsQuery.isSuccess || permissionsQuery.data.permissions.includes('case.update')}
                earlierStageEditable={viewModel.earlierStagesEditable}
                resolveActorName={(identityId) => staffList.find((staff) => staff.identityId === identityId)?.displayName ?? null}
                releaseSuggestions={[
                  { role: 'Next of kin', name: case_.nextOfKinName },
                  { role: 'Arrangement contact', name: case_.arrangementContactName },
                ]}
                isMedicalExaminerCase={case_.isMedicalExaminerCase === true}
                /* Classification belongs to intake, so the control lives on
                   the intake step alone rather than repeating on every
                   stage's checklist. The EDRS stage still SHOWS the three
                   ME verification items — that is the classification's
                   effect, not the control itself — and the header flag
                   keeps the classification visible from any step. */
                onToggleMedicalExaminerCase={
                  shownPresentedStageIndex === INTAKE_PRESENTED_STAGE_INDEX && case_.isDeleted !== true
                    ? (next) => mutations.updateCaseInfo({ isMedicalExaminerCase: next })
                    : undefined
                }
              />
            </section>
            )}

            <div className={styles.overviewPair}>
              <CaseLogCard
                entries={logEntries}
                onAddEntry={(input, options) => caseLog.addEntry(input, options)}
                onPrint={() =>
                  printTextLog('Case Log', viewModel.decedentName, viewModel.caseNumber, logEntries, (entry) => {
                    // Staff-typed text is escaped: the print window is same-origin.
                    const { headline, body } = caseLogEntryDisplay(entry);
                    const headlineHtml = headline ? `<div style="font-weight:600">${escapeHtml(headline)}</div>` : '';
                    return `<div style="margin-bottom:12px">${headlineHtml}${body ? `<div>${escapeHtml(body)}</div>` : ''}<div style="font-size:12px;color:#888">${escapeHtml(entry.author)} · ${formatTimestamp(entry.createdAt)}</div></div>`;
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
