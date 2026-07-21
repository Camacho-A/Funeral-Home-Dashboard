'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/hooks/useSession';
import { useCreateCase } from '@/hooks/useCreateCase';
import { buildIntakeFieldValues } from '@/domain/cases/checklist';
import styles from './NewCaseModal.module.css';

type FieldKey =
  | 'decedentName'
  | 'placeOfDeath'
  | 'dateOfBirth'
  | 'weight'
  | 'dateOfDeath'
  | 'timeOfDeath'
  | 'dcContact'
  | 'nextOfKinName'
  | 'nextOfKinPhone'
  | 'cardName'
  | 'cardNumber'
  | 'cardExp'
  | 'cardCvv'
  | 'cardZip';

type FieldMeta = {
  key: FieldKey;
  label: string;
  placeholder?: string;
  password?: boolean;
};

/**
 * Grouping/order/copy ported directly from design/support.js's
 * NEW_CASE_FIELDS. Two deliberate deviations from the source, each because
 * our typed data model is already better than the string it was hand-rolling:
 *
 * 1. "Your name (taking this call)" is shown read-only below, sourced from
 *    useSession(), not an editable picker — the original stored it as an
 *    arbitrary typed string and reused it verbatim as the new case's
 *    `owner`. It's the intake owner now (types/case.ts's `intakeOwnerId`),
 *    which is deliberately never form-editable: derived only from the
 *    trusted session, both here and again inside casesService.create.
 * 2. "Family contact — name, phone number & email" is two fields (name,
 *    phone) instead of one combined string. The original parsed a single
 *    typed value by splitting on " — ", which only worked if the user typed
 *    the delimiter exactly right; our Case type already has separate
 *    nextOfKinName/nextOfKinPhone fields, so there's nothing to parse.
 *
 * The checklist's own "Family contact"/"Cardholder..." items are still each
 * a single free-text field, so buildIntakeFieldValues recombines these split
 * inputs back into one string for fieldValues — the split only exists at
 * the structured-data layer, not the checklist's.
 */
const FIELD_GROUPS: { group: string; fields: FieldMeta[] }[] = [
  {
    group: 'Decedent',
    fields: [
      { key: 'decedentName', label: 'Name of deceased' },
      { key: 'placeOfDeath', label: 'Place of death — name, address & phone number' },
      { key: 'dateOfBirth', label: 'Date of birth', placeholder: 'MM/DD/YYYY' },
      { key: 'weight', label: 'Weight', placeholder: 'e.g. 165 lb' },
      { key: 'dateOfDeath', label: 'Date of death', placeholder: 'MM/DD/YYYY' },
      { key: 'timeOfDeath', label: 'Time of death', placeholder: '24hr, e.g. 14:30' },
    ],
  },
  {
    group: 'Contacts',
    fields: [
      { key: 'dcContact', label: 'Hospice or physician to sign DC — name & phone number' },
      { key: 'nextOfKinName', label: 'Next of kin — name' },
      { key: 'nextOfKinPhone', label: 'Next of kin — phone number' },
    ],
  },
  {
    group: 'Payment',
    fields: [
      { key: 'cardName', label: 'Name on card' },
      { key: 'cardNumber', label: 'Card number', password: true },
      { key: 'cardExp', label: 'Expiration (MM/YY)' },
      { key: 'cardCvv', label: 'CVV', password: true },
      { key: 'cardZip', label: 'Billing zip code' },
    ],
  },
];

const EMPTY_DRAFT: Record<FieldKey, string> = {
  decedentName: '',
  placeOfDeath: '',
  dateOfBirth: '',
  weight: '',
  dateOfDeath: '',
  timeOfDeath: '',
  dcContact: '',
  nextOfKinName: '',
  nextOfKinPhone: '',
  cardName: '',
  cardNumber: '',
  cardExp: '',
  cardCvv: '',
  cardZip: '',
};

export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const session = useSession();
  const createCase = useCreateCase();

  const [draft, setDraft] = useState<Record<FieldKey, string>>(EMPTY_DRAFT);

  function setField(key: FieldKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleClose() {
    setDraft(EMPTY_DRAFT);
    onClose();
  }

  const canSubmit = draft.decedentName.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;

    createCase.mutate(
      {
        decedentName: draft.decedentName.trim(),
        nextOfKinName: draft.nextOfKinName.trim(),
        nextOfKinPhone: draft.nextOfKinPhone.trim(),
        dateOfBirth: draft.dateOfBirth.trim() || undefined,
        dateOfDeath: draft.dateOfDeath.trim() || undefined,
        timeOfDeath: draft.timeOfDeath.trim() || undefined,
        placeOfDeath: draft.placeOfDeath.trim() || undefined,
        weight: draft.weight.trim() || undefined,
        fieldValues: buildIntakeFieldValues(draft),
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

      {FIELD_GROUPS.map((group) => (
        <div key={group.group} className={styles.group}>
          <div className={styles.groupLabel}>{group.group}</div>
          <div className={styles.groupFields}>
            {group.fields.map((field) => (
              <div key={field.key}>
                <div className={styles.fieldLabel}>{field.label}</div>
                <TextField
                  type={field.password ? 'password' : 'text'}
                  value={draft[field.key]}
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
