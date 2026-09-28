'use client';

import { use, useState } from 'react';
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
import { defaultAssigneeForCase } from '@/domain/tasks/rules';
import { printTextLog } from '@/utils/print';
import { formatTimestamp } from '@/utils/format';
import { CaseHeader } from '@/components/case/CaseHeader';
import { StageStepper, type StepperStage } from '@/components/case/StageStepper';
import { CaseInformationCard } from '@/components/case/CaseInformationCard';
import { CaseFormsSection } from '@/components/case/CaseFormsSection';
import { CaseWorkflowRepairPanel } from '@/components/case/CaseWorkflowRepairPanel';
import { CaseOrderCard } from '@/components/case/CaseOrderCard';
import { BillingCard } from '@/components/case/BillingCard';
import { ChecklistCard } from '@/components/case/ChecklistCard';
import { CaseLogCard } from '@/components/case/CaseLogCard';
import { CaseTasksCard, type CaseTaskItem } from '@/components/case/CaseTasksCard';
import { CaseActivityTab } from '@/components/case/CaseActivityTab';
import { CaseDocumentsTab } from '@/components/case/CaseDocumentsTab';
import { CaseScheduleTab } from '@/components/case/CaseScheduleTab';
import { CaseFamilyPortalTab } from '@/components/case/CaseFamilyPortalTab';
import styles from './page.module.css';

type CaseDetailTab = 'overview' | 'workflow' | 'activity' | 'documents' | 'schedule' | 'portal';

/**
 * Case Detail page (Frontend Engineering Plan, Phase 6) — the orchestration
 * layer. `params` is a Promise per Next.js 15's Client Component convention
 * (unwrapped with React's `use`, since a Client Component can't be async);
 * this is the only file in the case-detail feature that ever reads a route
 * param — everything below receives a plain `caseId: string`, per the
 * Route/feature decoupling principle.
 */
export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const [viewingDisplayStage, setViewingDisplayStage] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<CaseDetailTab>('overview');

  // Solis go-live checkpoint: Case Detail was opening scrolled to (or near)
  // the bottom — see useResetMainContentScrollOnChange's own comment for
  // the root cause. Keyed on caseId so this also covers navigating
  // directly from one case's detail page to another's, without touching
  // the Case List page's own scroll position (Case List -> Case -> Back
  // still restores where the list was).
  useResetMainContentScrollOnChange(caseId);

  const { data: case_, isPending } = useCase(caseId);
  const { data: staffList = [] } = useStaff();
  const { data: organizationRecord } = useOrganizationRecord();
  const familyPortalEnabled = isFamilyPortalEnabled(organizationRecord ?? null);
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  // Item #10 (2026-09, workflow repair relocation): the Workflow tab
  // contains only the Administrator-only repair/recalculation control
  // (CaseWorkflowRepairPanel, self-gated on `user.manageRoles` — see its
  // own comment). Since it has no other content, the tab itself is hidden
  // from anyone who can't use that control, rather than showing an empty
  // administrative tab. This mirrors the Family Portal tab's own
  // capability-gating pattern above; the underlying route independently
  // re-enforces authorization server-side regardless of this UI check.
  const canSeeWorkflowTab = Boolean(permissionsQuery.data?.permissions.includes('user.manageRoles'));
  const viewModel = useCaseViewModel(case_, viewingDisplayStage);
  const mutations = useCaseMutations(caseId);
  const caseLog = useCaseLog(caseId);
  const caseTasks = useCaseTasks(caseId);

  if (isPending) return <p className={styles.loading}>Loading case…</p>;

  // casesService.get resolves to null when the case doesn't exist or belongs
  // to a different organization — thrown here so the route's error.tsx
  // (built in Phase 0 for exactly this) renders instead of a blank page.
  if (case_ === null) {
    throw new Error(`Case ${caseId} not found for this organization`);
  }
  if (!case_ || !viewModel) return null;

  // Phase 11: sourced from viewModel.stageLabels (the case's own
  // workflowSnapshot) instead of a hardcoded STAGES import, so a case
  // belonging to a different organization's workflow template renders its
  // own stages correctly through this exact same page.
  const stepperStages: StepperStage[] = viewModel.stageLabels.map((label, index) => ({
    label,
    done: index < viewModel.displayStage,
    current: index === viewModel.displayStage,
    viewable: index <= viewModel.displayStage,
  }));

  const staffOptions = staffList.map((staff) => ({ id: staff.id, name: staff.displayName }));

  // Phase 17: newest first — a single sort shared by the on-screen list and
  // the Print callback below, so print output never disagrees with what's
  // actually on screen.
  const logEntries = [...(caseLog.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const caseLinkedTasks = caseTasks.data ?? [];

  const caseTaskItems: CaseTaskItem[] = caseLinkedTasks.map((task) => ({
    id: task.id,
    text: task.text,
    isDone: task.isDone,
    assigneeName:
      staffList.find((staff) => staff.id === task.assigneeStaffId)?.displayName ?? 'Office',
  }));

  return (
    <div>
      <CaseHeader
        caseNumber={viewModel.caseNumber}
        decedentName={viewModel.decedentName}
        dateOfBirth={viewModel.dateOfBirth}
        dateOfDeath={viewModel.dateOfDeath}
        tagNumber={case_.tagNumber}
        caseDetailStageHeading={viewModel.caseDetailStageHeading}
        stageBadgeVariant={viewModel.stageBadgeVariant}
        daysWaitingInStage={viewModel.daysWaitingInStage}
        slaTargetLabel={viewModel.slaTargetLabel}
        isOverdue={viewModel.isOverdue}
      />

      <StageStepper
        stages={stepperStages}
        onStepClick={(index) =>
          setViewingDisplayStage(index === viewModel.displayStage ? null : index)
        }
      />

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={activeTab === 'overview' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
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
          aria-selected={activeTab === 'documents'}
          className={activeTab === 'documents' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('documents')}
        >
          Documents
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

      {activeTab === 'workflow' && canSeeWorkflowTab && <CaseWorkflowRepairPanel caseId={caseId} />}
      {activeTab === 'activity' && (
        <CaseActivityTab caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />
      )}
      {activeTab === 'documents' && (
        <CaseDocumentsTab caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />
      )}
      {activeTab === 'schedule' && <CaseScheduleTab caseId={caseId} />}
      {activeTab === 'portal' && familyPortalEnabled && <CaseFamilyPortalTab caseId={caseId} />}

      {activeTab === 'overview' && (
      <div className={styles.overview}>
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

          <CaseFormsSection caseId={caseId} />

          <CaseOrderCard caseId={caseId} caseName={viewModel.decedentName} caseNumber={viewModel.caseNumber} />

          <BillingCard caseId={caseId} />

          <ChecklistCard
            checklist={viewModel.checklist}
            viewingStageLabel={viewingDisplayStage != null ? viewModel.stageLabels[viewingDisplayStage] : null}
            onBackToCurrentStage={() => setViewingDisplayStage(null)}
            onToggleItem={(index, newDone) => mutations.toggleChecklistItem(case_, index, newDone)}
            onFieldChange={(index, value) => mutations.setFieldValue(case_, index, value)}
          />

          <div className={styles.overviewPair}>
            <CaseLogCard
              entries={logEntries}
              authorName={viewModel.effectiveOwnerName}
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
      </div>
      )}
    </div>
  );
}
