'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import type { ConflictDetail } from '@/lib/appointmentsClient';
import styles from './ConflictResolutionDialog.module.css';

const CONFLICT_REASON_LABEL: Record<string, string> = {
  overlapping_assignment: 'already booked for an overlapping appointment',
  overlapping_unavailability: 'marked unavailable for this time',
  resource_out_of_service: 'out of service',
  resource_archived: 'archived',
};

/**
 * Phase 27 (Scheduling & Resource Management). Shown when
 * `AppointmentDialog`'s save attempt hits a hard conflict (HTTP 409, a
 * `SchedulingConflictError`). Lists exactly what's conflicting; offers
 * "Choose a different resource or time" (just close, back to the dialog
 * to edit) or, gated by `resource.manage`, "Override anyway" with a
 * required reason — producing `scheduling.resource.conflict_overridden`
 * server-side. Soft conflicts never reach this dialog — they're inline,
 * non-blocking warnings in `AppointmentDialog` itself per the approved
 * plan (§8), so nothing here ever renders a soft conflict.
 */
export function ConflictResolutionDialog({
  open,
  conflicts,
  onClose,
  onOverride,
  isSubmitting,
}: {
  open: boolean;
  conflicts: ConflictDetail[];
  onClose: () => void;
  onOverride: (reason: string) => void;
  isSubmitting: boolean;
}) {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canOverride = permissions === null || permissions.includes('resource.manage');

  const [reason, setReason] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Scheduling Conflict">
      <div className={styles.body}>
        <p className={styles.intro}>The following resources can&rsquo;t be booked for this time:</p>
        <ul className={styles.list}>
          {conflicts.map((conflict, index) => (
            <li key={`${conflict.resourceId}-${index}`} className={styles.item}>
              <span className={styles.resourceName}>{conflict.resourceName}</span> — {CONFLICT_REASON_LABEL[conflict.reason] ?? conflict.reason}
            </li>
          ))}
        </ul>

        {canOverride && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="conflict-override-reason">
              Override reason (required to proceed anyway)
            </label>
            <TextArea id="conflict-override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Choose a different resource or time
          </Button>
          {canOverride && (
            <Button type="button" variant="danger" onClick={() => onOverride(reason.trim())} disabled={!reason.trim() || isSubmitting}>
              {isSubmitting ? 'Overriding…' : 'Override anyway'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
