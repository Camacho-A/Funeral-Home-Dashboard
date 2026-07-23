'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCreateCase } from '@/hooks/useCreateCase';
import { useWorkflowTemplates } from '@/hooks/useWorkflowTemplates';
import { useOrganization } from '@/hooks/useOrganization';
import { useMutation } from '@tanstack/react-query';
import { caseLogService } from '@/services/caseLogService';
import { buildIntakeFieldValues, buildStructuredCaseFields } from '@/domain/workflow/resolveIntake';
import { formatDateInput, isValidCalendarDate, formatCardExpiryInput, isValidExpiryMonth } from '@/utils/inputMask';
import type { Case } from '@/types/case';
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
 *
 * Phase 16A (New Case UX Polish) — presentation-only behaviors plus one new
 * optional field, none of which touch IntakeFieldTemplate, WorkflowTemplate,
 * NewCaseInput, or the Wix write integration:
 *
 * 1. Free-text fields (name/address/description content) uppercase as the
 *    user types — UPPERCASE_FIELD_KEYS below. Deliberately excludes dates,
 *    the phone field, weight/time (numeric-shaped), and the entire Payment
 *    group (name on card, card number, expiration, CVV, zip) — "credit-card
 *    values" per this phase's own instruction, kept as one excluded group
 *    rather than picked apart field-by-field.
 * 2. Date fields (dateOfBirth, dateOfDeath) reformat toward MM/DD/YYYY as
 *    the user types (utils/inputMask.ts's formatDateInput — a digit-driven
 *    mask, not a caret-aware masking library, since none is installed in
 *    this project) and are validated as real calendar dates
 *    (isValidCalendarDate) once fully typed; canSubmit is blocked while a
 *    non-empty date field holds an incomplete or impossible date.
 * 3. cardExp reformats toward MM/YY (formatCardExpiryInput) and validates
 *    its month is 01-12 (isValidExpiryMonth), same blocking behavior.
 * 4. Fields flagged `password` in the template (cardNumber, cardCvv) render
 *    masked by default with a per-field Show/Hide toggle — REVEALED_FIELD
 *    local state — rather than being permanently unmasked. The
 *    IntakeFieldTemplate.password flag itself is untouched.
 * 5. An optional multiline Notes field. On successful case creation, if
 *    non-blank (after trimming only leading/trailing whitespace — internal
 *    line breaks are preserved), it's saved via the *existing*
 *    caseLogService (the same one Case Detail's CaseLogCard already uses)
 *    as a `type: 'note'` CaseLogEntry linked to the new case — no new or
 *    duplicate notes storage was introduced. `organizationId` comes from
 *    useOrganization() (trusted, session-resolved) and `author` from
 *    useSession() (the same session-derived trust already used for
 *    createdBy/intakeOwnerId elsewhere in this form) — never from a form
 *    field. See "Known architectural gap" below for why this still only
 *    reaches Wix in mock mode's sense (i.e., not at all).
 *
 * Known architectural gap, reported rather than silently worked around
 * (per this phase's own instruction): case log entries have **no Wix
 * collection and no Route Handler at all** — docs/WIX_DATA_SCHEMA.md's six
 * collections do not include one, and services/caseLogService.ts has no
 * `dataAdapterMode` parameter, unlike casesService/tasksService. This is
 * not a regression introduced here — case notes have never been Wix-backed,
 * in any phase — but it means the note this form saves lives only in the
 * same in-memory mock array regardless of DATA_ADAPTER, exactly as it
 * already did for every existing CaseLogCard note on every case detail
 * page. Building a real Wix-backed case-log collection was out of this
 * phase's scope (a schema + Route Handler + adapter migration on the scale
 * of Phases 15B-16, not "UX polish"); see the ADR for the full writeup.
 */
const UPPERCASE_FIELD_KEYS = new Set(['decedentName', 'placeOfDeath', 'dcContact', 'nextOfKinName']);
const DATE_FIELD_KEYS = new Set(['dateOfBirth', 'dateOfDeath']);
const EXPIRY_FIELD_KEYS = new Set(['cardExp']);
const NOTES_KEY = 'notes';

function fieldValidationError(key: string, value: string): string | null {
  if (DATE_FIELD_KEYS.has(key) && value !== '' && !isValidCalendarDate(value)) {
    return 'Enter a valid date (MM/DD/YYYY).';
  }
  if (EXPIRY_FIELD_KEYS.has(key) && value !== '' && !isValidExpiryMonth(value)) {
    return 'Enter a valid expiration (MM/YY).';
  }
  return null;
}

export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const session = useSession();
  const organization = useOrganization();
  const createCase = useCreateCase();
  const { data: templates } = useWorkflowTemplates();
  const template = templates?.find((t) => t.isEnabled);
  const intake = template?.versions[template.versions.length - 1]?.intake;

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

  function setField(key: string, rawValue: string) {
    let value = rawValue;
    if (DATE_FIELD_KEYS.has(key)) {
      value = formatDateInput(rawValue);
    } else if (EXPIRY_FIELD_KEYS.has(key)) {
      value = formatCardExpiryInput(rawValue);
    } else if (UPPERCASE_FIELD_KEYS.has(key)) {
      value = rawValue.toUpperCase();
    }
    setDraft((prev) => ({ ...prev, [key]: value }));
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

  const structuredFields = intake ? buildStructuredCaseFields(intake, draft) : {};

  const hasFieldErrors = Boolean(
    intake?.sections.some((section) =>
      section.fields.some((field) => fieldValidationError(field.key, draft[field.key] ?? '') !== null),
    ),
  );
  const canSubmit = Boolean(structuredFields.decedentName?.trim()) && !hasFieldErrors;

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
                onChange={(e) => setField(NOTES_KEY, e.target.value)}
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

          {intake?.sections.map((section) => (
            <div key={section.key} className={styles.group}>
              <div className={styles.groupLabel}>{section.label}</div>
              <div className={styles.groupFields}>
                {section.fields.map((field) => {
                  const value = draft[field.key] ?? '';
                  const error = touched[field.key] ? fieldValidationError(field.key, value) : null;
                  const isRevealable = Boolean(field.password);
                  const isRevealed = revealedFields[field.key];

                  return (
                    <div key={field.key}>
                      <div className={styles.fieldLabel}>{field.label}</div>
                      <div className={isRevealable ? styles.revealableFieldRow : undefined}>
                        <TextField
                          type={isRevealable && !isRevealed ? 'password' : 'text'}
                          value={value}
                          onChange={(e) => setField(field.key, e.target.value)}
                          onBlur={() => setTouched((prev) => ({ ...prev, [field.key]: true }))}
                          placeholder={field.placeholder}
                        />
                        {isRevealable && (
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
                      {error && (
                        <div className={styles.fieldError} role="alert">
                          {error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className={styles.group}>
            <div className={styles.groupLabel}>Notes (optional)</div>
            <div className={styles.groupFields}>
              <TextArea
                value={draft[NOTES_KEY] ?? ''}
                onChange={(e) => setField(NOTES_KEY, e.target.value)}
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
