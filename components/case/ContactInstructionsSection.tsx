'use client';

import { useEffect, useState } from 'react';
import type { CaseUpdate } from '@/types/case';
import { Checkbox } from '@/components/ui/Checkbox';
import { Modal } from '@/components/ui/Modal';
import styles from './ContactInstructionsSection.module.css';

/**
 * Contact instructions (2026-10).
 *
 * A grieving next of kin often asks that a relative or friend handle the
 * arrangements. Staff then need two things visible before they pick up the
 * phone: that the next of kin must not be called directly, and who to call
 * instead. Previously that lived in whatever free-text note someone
 * happened to use, which is not somewhere you can rely on seeing it.
 *
 * THE LEGAL SEPARATION IS THE POINT. Everything here is coordination
 * information. The Next of Kin section above remains the legal contact of
 * record, and nothing in this panel changes who may sign, authorize
 * cremation, or direct disposition. That is enforced structurally rather
 * than by convention: these fields are absent from
 * `domain/documents/mergeEngine.ts`'s MERGE_FIELD_CATALOG (an explicit
 * catalog, never a sweep over Case keys), so they cannot reach a death
 * certificate, authorization form, or Jotform submission unless someone
 * deliberately adds them there. They are likewise absent from
 * `domain/portal/portalCaseView.ts`'s explicit projection, so the family
 * portal never shows a family its own contact restriction. The panel still
 * says so in words, because a staff member reading the screen should not
 * have to infer it from the architecture.
 *
 * REMOVING A RESTRICTION IS CONFIRMED, ADDING ONE IS NOT. The asymmetry is
 * deliberate and matches the real-world consequence: ticking the box makes
 * staff more careful, while clearing it is what can lead to an unwanted
 * call to someone who asked not to be called. Only the destructive
 * direction interrupts.
 */

type ContactInstructionsSectionProps = {
  doNotContactNextOfKin: boolean;
  arrangementContactName: string | null;
  arrangementContactRelationship: string | null;
  arrangementContactPhone: string | null;
  arrangementContactEmail: string | null;
  contactInstructions: string | null;
  arrangementAuthorizationConfirmed: boolean;
  arrangementAuthorizationSource: string | null;
  /** The case's own next-of-kin name, shown in the confirmation dialog so
      staff see exactly whose restriction they are about to lift rather
      than confirming an abstraction. */
  nextOfKinName: string;
  onUpdateCaseInfo: (patch: CaseUpdate) => void;
  /** Read-only mode for roles without full case edit (mirrors the parent
      card's own pickup-only view). */
  readOnly?: boolean;
};

export function ContactInstructionsSection({
  doNotContactNextOfKin,
  arrangementContactName,
  arrangementContactRelationship,
  arrangementContactPhone,
  arrangementContactEmail,
  contactInstructions,
  arrangementAuthorizationConfirmed,
  arrangementAuthorizationSource,
  nextOfKinName,
  onUpdateCaseInfo,
  readOnly = false,
}: ContactInstructionsSectionProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  function handleToggleRestriction(next: boolean) {
    if (readOnly) return;
    // Adding applies immediately; removing routes through the dialog.
    if (next) {
      onUpdateCaseInfo({ doNotContactNextOfKin: true });
      return;
    }
    setConfirmingRemoval(true);
  }

  function confirmRemoval() {
    setConfirmingRemoval(false);
    // Only the flag is cleared. The arrangement contact, the instruction
    // text and the authorization record all stay exactly as they are —
    // lifting a restriction is not a reason to discard who the family
    // asked you to call, and silently wiping it would destroy the record
    // of why the restriction existed.
    onUpdateCaseInfo({ doNotContactNextOfKin: false });
  }

  const hasArrangementContact = (arrangementContactName ?? '').trim() !== '';

  return (
    <>
      <div className={styles.sectionHeading}>Contact instructions</div>
      <div className={styles.sectionHelperText}>
        Add an alternate contact for arrangements. The Next of Kin remains the legal contact.
      </div>

      {doNotContactNextOfKin && (
        <div className={styles.restrictionBanner} role="note">
          <span aria-hidden="true" className={styles.restrictionIcon}>
            !
          </span>
          <div>
            <div className={styles.restrictionTitle}>Do not contact the next of kin directly</div>
            <div className={styles.restrictionDetail}>
              {hasArrangementContact ? (
                <>
                  Route all contact through {arrangementContactName}
                  {(arrangementContactRelationship ?? '').trim() !== '' && ` (${arrangementContactRelationship})`}.
                </>
              ) : (
                // Never implies someone is available to call when nobody
                // has been named — an empty field is not consent and not a
                // substitute contact.
                'No arrangement contact has been recorded yet. Check with the case owner before contacting the family.'
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={`${styles.toggleRow} ${readOnly ? styles.toggleRowLocked : styles.toggleRowUnlocked}`}
        onClick={readOnly ? undefined : () => handleToggleRestriction(!doNotContactNextOfKin)}
      >
        <Checkbox
          checked={doNotContactNextOfKin}
          disabled={readOnly}
          onChange={readOnly ? undefined : () => handleToggleRestriction(!doNotContactNextOfKin)}
          tone="brand"
          aria-label="Do not contact next of kin directly"
        />
        <span className={styles.toggleLabel}>Do not contact next of kin directly</span>
      </div>

      <div className={styles.grid}>
        <InlineField
          label="Arrangement contact"
          value={arrangementContactName ?? ''}
          uppercase
          readOnly={readOnly}
          onSave={(v) => onUpdateCaseInfo({ arrangementContactName: nullIfBlank(v) })}
        />
        <InlineField
          label="Their relationship"
          value={arrangementContactRelationship ?? ''}
          uppercase
          readOnly={readOnly}
          onSave={(v) => onUpdateCaseInfo({ arrangementContactRelationship: nullIfBlank(v) })}
        />
        <InlineField
          label="Contact phone"
          value={arrangementContactPhone ?? ''}
          readOnly={readOnly}
          onSave={(v) => onUpdateCaseInfo({ arrangementContactPhone: nullIfBlank(v) })}
          // A phone number that is both click-to-edit and click-to-call
          // cannot be both on the same element, so the call affordance is
          // a separate, explicitly-labelled link beside the value — the
          // same `trailingBadge` shape Weight's "Notify crematory" uses.
          trailingBadge={
            (arrangementContactPhone ?? '').trim() !== '' ? (
              <a className={styles.callLink} href={`tel:${telHref(arrangementContactPhone ?? '')}`}>
                Call
              </a>
            ) : null
          }
        />
        <InlineField
          label="Contact email"
          value={arrangementContactEmail ?? ''}
          kind="email"
          readOnly={readOnly}
          onSave={(v) => onUpdateCaseInfo({ arrangementContactEmail: nullIfBlank(v) })}
        />
      </div>

      <InlineTextArea
        label="Notes / special instructions"
        value={contactInstructions ?? ''}
        readOnly={readOnly}
        placeholder="e.g. All calls to her son Michael after 6pm. Do not leave voicemail."
        onSave={(v) => onUpdateCaseInfo({ contactInstructions: nullIfBlank(v) })}
      />

      <div
        className={`${styles.toggleRow} ${readOnly ? styles.toggleRowLocked : styles.toggleRowUnlocked}`}
        onClick={
          readOnly
            ? undefined
            : () => onUpdateCaseInfo({ arrangementAuthorizationConfirmed: !arrangementAuthorizationConfirmed })
        }
      >
        <Checkbox
          checked={arrangementAuthorizationConfirmed}
          disabled={readOnly}
          onChange={
            readOnly
              ? undefined
              : () => onUpdateCaseInfo({ arrangementAuthorizationConfirmed: !arrangementAuthorizationConfirmed })
          }
          tone={arrangementAuthorizationConfirmed ? 'success' : 'brand'}
          aria-label="Next of kin confirmed this arrangement contact"
        />
        <span className={styles.toggleLabel}>Next of kin confirmed this arrangement contact</span>
      </div>

      {/* Shown whenever it is checked OR already holds text, so unchecking
          never makes a recorded reference invisible. */}
      {(arrangementAuthorizationConfirmed || (arrangementAuthorizationSource ?? '').trim() !== '') && (
        <InlineField
          label="How it was confirmed"
          value={arrangementAuthorizationSource ?? ''}
          readOnly={readOnly}
          onSave={(v) => onUpdateCaseInfo({ arrangementAuthorizationSource: nullIfBlank(v) })}
        />
      )}

      <Modal
        open={confirmingRemoval}
        onClose={() => setConfirmingRemoval(false)}
        title="Remove contact restriction?"
      >
        <p className={styles.dialogBody}>
          This case is marked <strong>do not contact next of kin directly</strong>. Removing it means
          staff will no longer be warned before contacting
          {nextOfKinName.trim() !== '' ? <> {nextOfKinName}</> : ' the next of kin'}.
        </p>
        <p className={styles.dialogBody}>
          The arrangement contact and any notes are kept. Only the restriction is removed, and the
          change is recorded in this case&rsquo;s activity history.
        </p>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.dialogCancel} onClick={() => setConfirmingRemoval(false)}>
            Keep restriction
          </button>
          <button type="button" className={styles.dialogConfirm} onClick={confirmRemoval}>
            Remove restriction
          </button>
        </div>
      </Modal>
    </>
  );
}

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Builds the `tel:` URI for a number as a human typed it. The DISPLAYED
 * value is never changed — only what the link dials.
 *
 * An extension is converted to a `,` pause rather than having its digits
 * stripped of their separator and run onto the end of the number: naive
 * cleaning turns "214-555-0199 ext 4" into `tel:21455501994`, which is a
 * different, wrong, eleven-digit number that would dial a stranger. With
 * the pause it becomes `tel:2145550199,4`, which dials the number and then
 * sends the extension — the behavior every phone OS expects.
 */
function telHref(phone: string): string {
  const [number, ...extensionParts] = phone.split(/\b(?:ext|extension|x)\b\.?/i);
  const digits = (value: string) => value.replace(/[^0-9+]/g, '');

  const base = digits(number);
  const normalized = base.startsWith('+') ? `+${base.slice(1).replace(/\+/g, '')}` : base.replace(/\+/g, '');
  const extension = digits(extensionParts.join('')).replace(/\+/g, '');

  return extension === '' ? normalized : `${normalized},${extension}`;
}

/**
 * Single-line click-to-edit field. A deliberately local, smaller sibling of
 * CaseInformationCard's own EditableField: that one carries date/time
 * masking and cross-field calendar validation this panel has no use for,
 * and is not exported. Commit semantics match it exactly — Enter or blur
 * commits, Escape reverts — so editing behaves identically across the card.
 */
function InlineField({
  label,
  value,
  onSave,
  kind = 'text',
  uppercase = false,
  readOnly = false,
  trailingBadge = null,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  kind?: 'text' | 'email';
  uppercase?: boolean;
  readOnly?: boolean;
  trailingBadge?: React.ReactNode;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Echoes a just-committed value so the display doesn't flicker back to
  // the stale prop while the mutation is in flight — same approach as
  // EditableField's own pendingValue.
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (pending !== null && value === pending) setPending(null);
  }, [value, pending]);

  const display = pending ?? value;

  function commitOrRevert() {
    setIsEditing(false);
    const trimmed = draft.trim();
    // An invalid address reverts rather than being saved, matching
    // EditableField kind="email".
    if (kind === 'email' && trimmed !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setDraft(display);
      return;
    }
    if (trimmed !== display) {
      setPending(trimmed);
      onSave(trimmed);
    }
  }

  if (isEditing && !readOnly) {
    return (
      <div>
        <div className={styles.fieldLabel}>{label}</div>
        <input
          className={styles.input}
          autoFocus
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(uppercase ? e.target.value.toUpperCase() : e.target.value)}
          onBlur={commitOrRevert}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitOrRevert();
            else if (e.key === 'Escape') {
              setDraft(display);
              setIsEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.valueRow}>
        {readOnly ? (
          <span className={styles.readOnlyValue}>{display || '—'}</span>
        ) : (
          <button
            type="button"
            className={styles.editableValue}
            onClick={() => {
              setDraft(display);
              setIsEditing(true);
            }}
          >
            {display || '—'}
          </button>
        )}
        {trailingBadge}
      </div>
    </div>
  );
}

/**
 * Multiline click-to-edit field for the instruction notes. Enter inserts a
 * newline here rather than committing — these are sentences, not a
 * single-line value — so commit is on blur, with Escape still reverting.
 */
function InlineTextArea({
  label,
  value,
  onSave,
  placeholder,
  readOnly = false,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (pending !== null && value === pending) setPending(null);
  }, [value, pending]);

  const display = pending ?? value;

  function commit() {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== display) {
      setPending(trimmed);
      onSave(trimmed);
    }
  }

  return (
    <div className={styles.instructionsBlock}>
      <div className={styles.fieldLabel}>{label}</div>
      {isEditing && !readOnly ? (
        <textarea
          className={styles.textarea}
          autoFocus
          aria-label={label}
          rows={3}
          maxLength={2000}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(display);
              setIsEditing(false);
            }
          }}
        />
      ) : readOnly ? (
        <p className={styles.instructionsText}>{display || '—'}</p>
      ) : (
        <button
          type="button"
          className={styles.instructionsButton}
          onClick={() => {
            setDraft(display);
            setIsEditing(true);
          }}
        >
          {display || <span className={styles.placeholder}>{placeholder ?? 'Add instructions'}</span>}
        </button>
      )}
    </div>
  );
}
