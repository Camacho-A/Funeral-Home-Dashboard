'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCreateCase } from '@/hooks/useCreateCase';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { useOrganization } from '@/hooks/useOrganization';
import { useMutation } from '@tanstack/react-query';
import { caseLogService } from '@/services/caseLogService';
import { buildIntakeFieldValues, buildStructuredCaseFields } from '@/domain/workflow/resolveIntake';
import { resolveSectionFields, type ResolvedIntakeField } from '@/domain/workflow/resolveIntakeField';
import { formatDateInput, formatCardExpiryInput, getValidationError, normalizeTimeInput } from '@/utils/inputMask';
import type { Case } from '@/types/case';
import type { IntakeTemplate } from '@/types/workflowTemplate';
import styles from './NewCaseModal.module.css';

/**
 * Phase 11 (Workflow Template Architecture): intake sections/fields are no
 * longer hardcoded here — they render generically from the organization's
 * resolved WorkflowTemplate (useWorkflowTemplates()), specifically its
 * latest version's IntakeTemplate.
 *
 * Phase 19 (Configurable Intake Form Builder) generalizes this further:
 * every per-field *behavior* (uppercase, masking, date/expiration
 * formatting, validation, which control renders) used to be hardcoded here
 * by literal field key (UPPERCASE_FIELD_KEYS, DATE_FIELD_KEYS,
 * EXPIRY_FIELD_KEYS) — that only ever worked for Managed Cremations' own
 * field names. It's all data now: domain/workflow/resolveIntakeField.ts's
 * resolveIntakeField reads each IntakeFieldTemplate's fieldType/uppercase/
 * masked/validationType/etc. (falling back to safe defaults for any
 * pre-Phase-19 field missing them), and renderIntakeField below switches
 * purely on the *resolved* field, never on `field.key`. See
 * docs/adr/ADR-020-configurable-intake-form-builder.md.
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
 *
 * Backward compatibility (Phase 19): if the organization's latest workflow
 * version has no intake fields configured at all (`intake.sections` empty
 * or missing — never true for Managed Cremations' own fixture/Wix data
 * today, but a real possibility for a brand-new, not-yet-configured
 * organization), FALLBACK_INTAKE below renders instead — a minimal
 * always-functional form (decedent name, next of kin name/phone), not a
 * blank screen. This is a safety net, not a byte-for-byte reproduction of
 * any specific organization's full form — an org that wants more configures
 * it in Settings (components/settings/'s intake editor).
 *
 * decedentName is the only field genuinely gated by `required` today
 * (matching the exact pre-Phase-19 canSubmit check) — nextOfKinName/Phone
 * were never actually enforced as required by this modal even though
 * NewCaseInput's type marks them non-optional; preserved exactly as-is
 * rather than opportunistically tightening validation beyond what this
 * phase asked for. See the mock fixture for where `required: true` is set.
 *
 * An optional multiline Notes field (Phase 16A) is unrelated to the
 * configurable intake system — it's this modal's own initial-note capture
 * feature, saved via caseLogService, untouched by this phase.
 */
const NOTES_KEY = 'notes';

const FALLBACK_INTAKE: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [
        {
          key: 'decedentName',
          label: 'Name of deceased',
          fieldType: 'text',
          required: true,
          uppercase: true,
          mapsToCaseField: 'decedentName',
        },
        {
          key: 'nextOfKinName',
          label: 'Next of kin — name',
          fieldType: 'text',
          uppercase: true,
          mapsToCaseField: 'nextOfKinName',
        },
        {
          key: 'nextOfKinPhone',
          label: 'Next of kin — phone number',
          fieldType: 'phone',
          mapsToCaseField: 'nextOfKinPhone',
        },
      ],
    },
  ],
};

export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const session = useSession();
  const organization = useOrganization();
  const createCase = useCreateCase();
  const { data: templates, isSuccess: templatesLoaded } = useWorkflowTemplates();
  const template = templates?.find((t) => t.isEnabled);
  const templateIntake = template?.versions[template.versions.length - 1]?.intake;
  // FALLBACK_INTAKE only ever applies once the real fetch has genuinely
  // resolved and come back with no usable intake fields — never while
  // `templates` is still loading (`intake: undefined` renders zero fields
  // in that case, exactly like every phase before this one), so a slow
  // network request is never masked by a fallback that looks like real data.
  const intake = !templatesLoaded
    ? undefined
    : templateIntake && templateIntake.sections.length > 0
      ? templateIntake
      : FALLBACK_INTAKE;
  const effectiveIntake = intake ?? { sections: [] };

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});

  // Set only once a case has actually been created — distinguishes "not
  // submitted yet" from "case exists, but its note failed to save," so a
  // note-save retry never re-creates the case (never a duplicate).
  const [createdCase, setCreatedCase] = useState<Case | null>(null);

  const addNote = useMutation({
    mutationFn: ({ caseId, text }: { caseId: string; text: string }) =>
      caseLogService.create(organization, caseId, { type: 'note', text, author: session.displayName }),
  });

  function setDraftValue(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function setIntakeFieldValue(field: ResolvedIntakeField, rawValue: string) {
    let value = rawValue;
    if (field.fieldType === 'date') {
      value = formatDateInput(rawValue);
    } else if (field.fieldType === 'expiration') {
      value = formatCardExpiryInput(rawValue);
    } else if (field.uppercase) {
      value = rawValue.toUpperCase();
    }
    setDraftValue(field.key, value);
  }

  function markTouched(key: string) {
    setTouched((prev) => ({ ...prev, [key]: true }));
  }

  /**
   * Phase 19.1 (Time Input Normalization). On blur, a time field's raw
   * typed text ("2:30 PM") is replaced with its canonical "HH:mm" form via
   * the one shared utils/inputMask.ts#normalizeTimeInput — the same
   * function components/case/CaseInformationCard.tsx's inline editor uses.
   * An invalid/ambiguous value is left exactly as typed (per "preserve
   * invalid user input for correction") — getValidationError's own 'time'
   * case (below, in renderIntakeField) then reports the same failure as an
   * inline error once `touched` is set.
   */
  function handleFieldBlur(field: ResolvedIntakeField) {
    markTouched(field.key);
    if (field.fieldType === 'time') {
      const normalized = normalizeTimeInput(draft[field.key] ?? field.defaultValue);
      if (normalized !== null) setDraftValue(field.key, normalized);
    }
  }

  function toggleReveal(key: string) {
    setRevealedFields((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function resetForm() {
    setDraft({});
    setTouched({});
    setRevealedFields({});
    setCreatedCase(null);
    addNote.reset();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  const resolvedSections = effectiveIntake.sections.map((section) => ({
    section,
    fields: resolveSectionFields(section),
  }));
  const allResolvedFields = resolvedSections.flatMap(({ fields }) => fields);

  const structuredFields = buildStructuredCaseFields(effectiveIntake, draft);

  const hasFieldErrors = allResolvedFields.some(
    (field) => getValidationError(field.validationType, draft[field.key] ?? field.defaultValue) !== null,
  );
  const hasMissingRequired = allResolvedFields.some(
    (field) => field.required && !(draft[field.key] ?? field.defaultValue).trim(),
  );
  const canSubmit = !hasMissingRequired && !hasFieldErrors;

  function goToCase(caseId: string) {
    resetForm();
    onClose();
    router.push(`/cases/${caseId}`);
  }

  function saveNoteThenNavigate(caseId: string, noteText: string) {
    addNote.mutate(
      { caseId, text: noteText },
      { onSuccess: () => goToCase(caseId) },
    );
  }

  function handleSubmit() {
    if (!canSubmit) return;

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
        fieldValues: buildIntakeFieldValues(effectiveIntake, draft),
      },
      {
        onSuccess: (newCase) => {
          const noteText = (draft[NOTES_KEY] ?? '').trim();
          if (!noteText) {
            goToCase(newCase.id);
            return;
          }
          // The case is now real; remember it so a note-save failure never
          // re-triggers case creation, and the "Retry saving note"/
          // "Continue without note" panel below has something to act on.
          setCreatedCase(newCase);
          saveNoteThenNavigate(newCase.id, noteText);
        },
      },
    );
  }

  // Partial-failure state: the case was created, but its note failed to
  // save. Distinct from a case-creation failure (createCase.isError),
  // which still surfaces as an ordinary disabled/retry-the-whole-form state
  // via the Create Case button below.
  const noteSaveFailed = Boolean(createdCase) && addNote.isError;

  function renderIntakeField(field: ResolvedIntakeField): ReactNode {
    const value = draft[field.key] ?? field.defaultValue;
    const error = touched[field.key] ? getValidationError(field.validationType, value) : null;
    const isRevealed = revealedFields[field.key];
    const labelClassName = field.required
      ? `${styles.fieldLabel} ${styles.fieldLabelRequired}`
      : styles.fieldLabel;

    let control: ReactNode;
    if (field.fieldType === 'select') {
      control = (
        <SelectField
          value={value}
          onChange={(e) => setDraftValue(field.key, e.target.value)}
          onBlur={() => handleFieldBlur(field)}
          aria-label={field.label}
        >
          <option value="">{field.placeholder ?? 'Select…'}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>
      );
    } else if (field.fieldType === 'checkbox') {
      control = (
        <Checkbox
          checked={value === 'true'}
          onChange={() => setDraftValue(field.key, value === 'true' ? '' : 'true')}
          aria-label={field.label}
        />
      );
    } else if (field.multiline) {
      control = (
        <TextArea
          value={value}
          onChange={(e) => setIntakeFieldValue(field, e.target.value)}
          onBlur={() => handleFieldBlur(field)}
          placeholder={field.placeholder}
          aria-label={field.label}
        />
      );
    } else {
      control = (
        <div className={field.masked ? styles.revealableFieldRow : undefined}>
          <TextField
            type={field.masked && !isRevealed ? 'password' : 'text'}
            value={value}
            onChange={(e) => setIntakeFieldValue(field, e.target.value)}
            onBlur={() => handleFieldBlur(field)}
            placeholder={field.placeholder}
          />
          {field.masked && (
            <button
              type="button"
              className={styles.revealToggle}
              onClick={() => toggleReveal(field.key)}
              aria-label={`${isRevealed ? 'Hide' : 'Show'} ${field.label}`}
            >
              {isRevealed ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
      );
    }

    return (
      <div key={field.key}>
        <div className={labelClassName}>{field.label}</div>
        {control}
        {error && (
          <div className={styles.fieldError} role="alert">
            {error}
          </div>
        )}
      </div>
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

      {noteSaveFailed && createdCase ? (
        <>
          <div className={styles.partialFailureBanner} role="alert">
            Case created successfully. We couldn&apos;t save your note — you can try again, or continue
            to the case without it.
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}>Notes</div>
            <div className={styles.groupFields}>
              <TextArea
                value={draft[NOTES_KEY] ?? ''}
                onChange={(e) => setDraftValue(NOTES_KEY, e.target.value)}
                placeholder="e.g. Family requested a biodegradable urn. Mail death certificate copy to next of kin."
              />
            </div>
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => goToCase(createdCase.id)}>
              Continue without note
            </Button>
            <Button
              onClick={() => saveNoteThenNavigate(createdCase.id, (draft[NOTES_KEY] ?? '').trim())}
              disabled={addNote.isPending || !(draft[NOTES_KEY] ?? '').trim()}
            >
              Retry saving note
            </Button>
          </div>
        </>
      ) : (
        <>
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

          {resolvedSections.map(({ section, fields }) => (
            <div key={section.key} className={styles.group}>
              <div className={styles.groupLabel}>{section.label}</div>
              <div className={styles.groupFields}>{fields.map((field) => renderIntakeField(field))}</div>
            </div>
          ))}

          <div className={styles.group}>
            <div className={styles.groupLabel}>Notes (optional)</div>
            <div className={styles.groupFields}>
              <TextArea
                value={draft[NOTES_KEY] ?? ''}
                onChange={(e) => setDraftValue(NOTES_KEY, e.target.value)}
                placeholder="e.g. Family requested a biodegradable urn. Mail death certificate copy to next of kin."
              />
            </div>
          </div>

          <div className={styles.footer}>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || createCase.isPending}>
              Create case
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
