'use client';

import { use, useState } from 'react';
import { useCase } from '@/hooks/useCase';
import { useCaseViewModel } from '@/hooks/useCaseViewModel';
import { useCaseMutations } from '@/hooks/useCaseMutations';
import { useCaseLog } from '@/hooks/useCaseLog';
import { useCaseDocuments } from '@/hooks/useCaseDocuments';
import { useCaseTasks } from '@/hooks/useCaseTasks';
import { useStaff } from '@/hooks/useStaff';
import { useSession } from '@/hooks/useSession';
import { defaultAssigneeForCase } from '@/domain/tasks/rules';
import { printFile, printTextLog } from '@/utils/print';
import { formatDaysAgo, formatTimestamp } from '@/utils/format';
import { CaseHeader } from '@/components/case/CaseHeader';
import { StageStepper, type StepperStage } from '@/components/case/StageStepper';
import { CaseInformationCard } from '@/components/case/CaseInformationCard';
import { ChecklistCard } from '@/components/case/ChecklistCard';
import { CaseLogCard } from '@/components/case/CaseLogCard';
import { CaseTasksCard, type CaseTaskItem } from '@/components/case/CaseTasksCard';
import { ActivityLogCard } from '@/components/case/ActivityLogCard';
import { DocumentsCard, type DocumentRowItem } from '@/components/case/DocumentsCard';
import styles from './page.module.css';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

  const { data: case_, isPending } = useCase(caseId);
  const { data: staffList = [] } = useStaff();
  const session = useSession();
  const viewModel = useCaseViewModel(case_, viewingDisplayStage);
  const mutations = useCaseMutations(caseId);
  const caseLog = useCaseLog(caseId);
  const documents = useCaseDocuments(caseId);
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

  const logEntries = caseLog.data ?? [];
  const uploadedDocuments = documents.data ?? [];
  const caseLinkedTasks = caseTasks.data ?? [];

  const documentRows: DocumentRowItem[] = [
    ...viewModel.requiredDocuments.map((doc) => ({
      id: `required-${doc.label}`,
      name: doc.label,
      status: capitalize(doc.status),
      onPrint: () => printFile(undefined, doc.label, viewModel.decedentName, viewModel.caseNumber),
    })),
    ...uploadedDocuments.map((doc) => ({
      id: doc.id,
      name: doc.fileName,
      // The prototype always shows "Uploaded" for a user-added document,
      // regardless of the persisted status enum (which tracks lifecycle
      // state like "active"/"superseded" for the compliance service, not
      // display text) — matched here rather than surfacing the raw enum.
      status: 'Uploaded',
      meta: `${doc.uploadedBy} · ${formatTimestamp(doc.uploadedAt)}`,
      onPrint: () => printFile(documents.getFile(doc.id), doc.fileName, viewModel.decedentName, viewModel.caseNumber),
      onRemove: () => documents.remove(doc.id),
    })),
  ];

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
        stageLabel={viewModel.stageLabel}
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

      <div className={styles.columns}>
        <div className={styles.column}>
          <CaseInformationCard
            dateOfBirth={viewModel.dateOfBirth}
            dateOfDeath={viewModel.dateOfDeath}
            timeOfDeath={viewModel.timeOfDeath}
            placeOfDeath={viewModel.placeOfDeath}
            weight={viewModel.weight}
            weightOver200={viewModel.weightOver200}
            nextOfKinName={case_.nextOfKinName}
            nextOfKinPhone={case_.nextOfKinPhone}
            paymentStatus={viewModel.paymentStatus}
            ownerStaffId={viewModel.ownerStaffId}
            staffOptions={staffOptions}
            onReassignOwner={(staffId) => mutations.reassignOwner(staffId)}
            isVeteran={viewModel.isVeteran}
            veteranFlagLocked={viewModel.veteranFlagLocked}
            onToggleVeteran={(newValue) => mutations.setVeteranFlag(newValue)}
            vaSteps={viewModel.vaSteps}
            vaCallbackDone={viewModel.vaCallbackDone}
            vaPublishChoice={viewModel.vaPublishChoice}
            onToggleVaStep={(index, newDone) => mutations.toggleVaStep(case_, index, newDone)}
            onSetVaPublishChoice={(choice) => mutations.setVaPublishChoice(choice)}
          />

          <ChecklistCard
            checklist={viewModel.checklist}
            viewingStageLabel={viewingDisplayStage != null ? viewModel.stageLabels[viewingDisplayStage] : null}
            onBackToCurrentStage={() => setViewingDisplayStage(null)}
            onToggleItem={(index, newDone) => mutations.toggleChecklistItem(case_, index, newDone)}
            onFieldChange={(index, value) => mutations.setFieldValue(case_, index, value)}
          />

          <CaseLogCard
            entries={logEntries}
            authorName={viewModel.effectiveOwnerName}
            onAddEntry={(input) => caseLog.addEntry(input)}
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

        <div className={styles.column}>
          <ActivityLogCard
            timeline={viewModel.timeline}
            onPrint={() =>
              printTextLog('Activity Log', viewModel.decedentName, viewModel.caseNumber, viewModel.timeline, (entry) => {
                return `<div style="margin-bottom:10px"><span style="font-weight:600">${entry.who}</span> ${entry.what}<div style="font-size:12px;color:#888">${formatDaysAgo(entry.daysAgo)}</div></div>`;
              })
            }
          />

          <DocumentsCard
            documents={documentRows}
            onUploadFiles={(files) => {
              files.forEach((file) =>
                documents.upload({
                  input: { fileName: file.name, uploadedBy: session.displayName },
                  file,
                }),
              );
            }}
            onPrintAll={() => {
              documentRows.forEach((doc, index) => setTimeout(() => doc.onPrint(), index * 400));
            }}
          />
        </div>
      </div>
    </div>
  );
}
