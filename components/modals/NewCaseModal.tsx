'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCreateCase } from '@/hooks/useCreateCase';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { buildIntakeFieldValues, buildStructuredCaseFields } from '@/domain/workflow/resolveIntake';
import styles from './NewCaseModal.module.css';

/**
 * Phase 11 (Workflow Template Architecture): intake sections/fields are no
 * longer hardcoded here — they render generically from the organization's
 * resolved WorkflowTemplate (useWorkflowTemplates()), specifically its
 * latest version's IntakeTemplate. Managed Cremations' rendered form is
 * unchanged (same groups/labels/placeholders/order) because its template
 * fixture mirrors the pre-Phase-11 hardcoded field list exactly — see
 * services/__mocks__/workflowTemplates.ts.
 *
 * The modal's title and description text stay static English copy, not
 * template-driven — templatizing UI copy (as opposed to field structure)
 * wasn't part of this phase's required behavior, and "First Call & Payment"
 * is specifically Managed Cremations' own stage name, so a second
 * organization would need its own copy anyway; deferring that is a
 * documented scope limit (docs/TEMPLATE_VERSIONING.md), not an oversight.
 *
 * Two deliberate deviations from the original design/support.js prototype,
 * carried into the template fixture rather than this component (so they'd
 * apply to any organization, not just this one):
 *
 * 1. "Your name (taking this call)" is shown read-only below, sourced from
 *    useSession(), and isn't part of the intake template at all — the
 *    original stored it as an arbitrary typed string and reused it verbatim
 *    as the new case's `owner`. It's the intake owner now (types/case.ts's
 *    `intakeOwnerId`), deliberately never form-editable: derived only from
 *    the trusted session, both here and again inside casesService.create.
 * 2. "Family contact — name, phone number & email" is two fields (name,
 *    phone) instead of one combined string, since our Case type already
 *    has separate nextOfKinName/nextOfKinPhone fields — see the template
 *    fixture's own comment for how they still recombine into the
 *    checklist's one free-text item.
 */
export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const session = useSession();
  const createCase = useCreateCase();
  const { data: templates } = useWorkflowTemplates();
  const template = templates?.find((t) => t.isEnabled);
  const intake = template?.versions[template.versions.length - 1]?.intake;

  const [draft, setDraft] = useState<Record<string, string>>({});

  function setField(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleClose() {
    setDraft({});
    onClose();
  }

  const structuredFields = intake ? buildStructuredCaseFields(intake, draft) : {};
  const canSubmit = Boolean(structuredFields.decedentName?.trim());

  function handleSubmit() {
    if (!canSubmit || !intake) return;

    createCase.mutate(
      {
        decedentName: structuredFields.decedentName ?? '',
        nextOfKinName: structuredFields.nextOfKinName ?? '',
        nextOfKinPhone: structuredFields.nextOfKinPhone ?? '',
        dateOfBirth: structuredFields.dateOfBirth || undefined,
        dateOfDeath: structuredFields.dateOfDeath || undefined,
        timeOfDeath: structuredFields.timeOfDeath || undefined,
        placeOfDeath: structuredFields.placeOfDeath || undefined,
        weight: structuredFields.weight || undefined,
        fieldValues: buildIntakeFieldValues(intake, draft),
      },
      {
        onSuccess: (newCase) => {
          handleClose();
          router.push(`/cases/${newCase.id}`);
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Case — First Call">
      <div className={styles.header}>
        <div className={styles.title}>New Case — First Call</div>
        <button type="button" className={styles.closeButton} onClick={handleClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={styles.description}>
        Whatever you enter here carries straight into the case&apos;s First Call &amp; Payment
        checklist — no retyping. Anything left blank stays open there, and the case can&apos;t move
        past this stage until every item is complete.
      </div>

      <div className={styles.group}>
        <div className={styles.groupLabel}>Intake</div>
        <div className={styles.groupFields}>
          <div>
            <div className={styles.fieldLabel}>Your name (taking this call)</div>
            {/* Read-only by design — the intake owner is the authenticated
                session's staff member, never a form choice. See
                types/case.ts's intakeOwnerId comment. */}
            <div className={styles.readOnlyValue}>{session.displayName}</div>
          </div>
        </div>
      </div>

      {intake?.sections.map((section) => (
        <div key={section.key} className={styles.group}>
          <div className={styles.groupLabel}>{section.label}</div>
          <div className={styles.groupFields}>
            {section.fields.map((field) => (
              <div key={field.key}>
                <div className={styles.fieldLabel}>{field.label}</div>
                <TextField
                  type={field.password ? 'password' : 'text'}
                  value={draft[field.key] ?? ''}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || createCase.isPending}>
          Create case
        </Button>
      </div>
    </Modal>
  );
}
