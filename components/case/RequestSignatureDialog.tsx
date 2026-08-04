'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useCreateSignatureRequest } from '@/hooks/useSignatureRequests';
import type { SignerRole } from '@/types/signatureRequest';
import styles from './RequestSignatureDialog.module.css';

// Phase 27 (Scheduling & Resource Management): 'witness' is deliberately
// excluded — a witness SignatureRequest is only ever created
// programmatically by services/schedulingService.ts, tied to a specific
// Witness Cremation appointment, never picked freely from this dialog.
const SIGNER_ROLE_LABEL: Record<Exclude<SignerRole, 'witness'>, string> = {
  primary_contact: 'Primary Contact',
  secondary_contact: 'Secondary Contact',
  next_of_kin: 'Next of Kin',
  authorized_representative: 'Authorized Representative',
  funeral_director: 'Funeral Director',
  internal_staff: 'Internal Staff',
};

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Structural
 * twin of `GenerateDocumentDialog.tsx` — signer name/email, a signer-role
 * dropdown (a descriptive label, not an RBAC principal — see
 * `types/signatureRequest.ts`'s own comment), an optional expiration date
 * (omitted resolves to the service's own 30-day default), and Send.
 */
export function RequestSignatureDialog({
  open,
  onClose,
  organizationId,
  caseId,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  caseId: string;
  documentId: string;
}) {
  const createRequest = useCreateSignatureRequest(organizationId, caseId, documentId);

  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerRole, setSignerRole] = useState<SignerRole>('next_of_kin');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSignerName('');
    setSignerEmail('');
    setSignerRole('next_of_kin');
    setExpiresAt('');
    setError(null);
  }, [open]);

  async function handleSend() {
    if (!signerName.trim() || !signerEmail.trim()) return;
    setError(null);
    try {
      await createRequest.mutateAsync({
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        signerRole,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the signature request.');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request Signature">
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="request-signature-name">
            Signer name
          </label>
          <TextField id="request-signature-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="request-signature-email">
            Signer email
          </label>
          <TextField id="request-signature-email" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="request-signature-role">
            Signer role
          </label>
          <SelectField id="request-signature-role" value={signerRole} onChange={(e) => setSignerRole(e.target.value as SignerRole)}>
            {Object.entries(SIGNER_ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="request-signature-expires">
            Expires (optional)
          </label>
          <TextField id="request-signature-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <span className={styles.hint}>Defaults to 30 days from now if left blank.</span>
        </div>

        {error && <span className={styles.error}>{error}</span>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={!signerName.trim() || !signerEmail.trim() || createRequest.isPending}>
            {createRequest.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
