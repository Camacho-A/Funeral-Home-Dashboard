'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Badge } from '@/components/ui/Badge';
import { correctableSignOffs, RELEASE_STATUS_LABEL, releaseEventsOf } from '@/domain/servicePreparation/releaseHolds';
import { RELEASE_FOR_CREMATION_UNAVAILABLE_REASON } from '@/domain/servicePreparation/releaseForCremation';
import type { ServicePreparationRecord } from '@/domain/servicePreparation/types';
import type { CallerReleaseView } from '@/services/cremationReleaseService';
import styles from './ServiceReadinessCard.module.css';

/**
 * Release for cremation — the release-hold workflow (Gus, 2026-11).
 * Administrators, Managers and Funeral Directors request a release, place a
 * hold (with a reason) and ask for reauthorization; a licensed, authorized
 * director's sign-off releases or reauthorizes, after every requirement is
 * rechecked. Every step stays in the history. A hold never recalls
 * paperwork already sent — the card says so. A pending request can be
 * withdrawn; a wrong sign-off is corrected by appending a correction (with a
 * reason), never by editing it.
 */
type Action = 'release' | 'sign_off' | 'hold' | 'reauthorize' | 'withdraw' | 'correct';

const EVENT_LABEL = {
  release_requested: 'Release requested',
  released: 'Released',
  hold_placed: 'Placed on hold',
  reauthorization_requested: 'Reauthorization requested',
  reauthorized: 'Reauthorized',
  request_withdrawn: 'Request withdrawn',
  release_corrected: 'Sign-off corrected',
} as const;

export function ReleaseWorkflowSection({
  release,
  record,
  serviceName,
  canEdit,
  isSaving,
  error,
  onAction,
  formatWhen,
}: {
  release: CallerReleaseView | null;
  record: ServicePreparationRecord | null;
  serviceName: string;
  canEdit: boolean;
  isSaving: boolean;
  error: string | null;
  onAction: (input: { action: Action; reason?: string; correctsEventId?: string }, done: () => void) => void;
  formatWhen: (iso: string) => string;
}) {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const events = releaseEventsOf(record);
  const correctable = correctableSignOffs(record);
  const [correctsEventId, setCorrectsEventId] = useState<string>('');
  const correcting = correctsEventId || correctable.at(-1)?.eventId || '';
  const status = release?.status ?? 'not_released';
  const caps = release?.capabilities;
  const active = release?.active === true && canEdit;
  const done = () => {
    setConfirming(null);
    setReason('');
    setCorrectsEventId('');
  };
  const needsReason = confirming === 'hold' || confirming === 'correct';

  const button = (action: Action, label: string, allowed: boolean | undefined) =>
    allowed ? (
      <button key={action} type="button" className={styles.releaseButton} disabled={!active || isSaving} onClick={() => setConfirming(action)}>
        {label}
      </button>
    ) : null;
  const buttons = [
    button('release', caps?.isLicensedSigner && release?.allPrerequisitesMet ? 'Release for cremation' : 'Request release', caps?.canRequestRelease),
    button('sign_off', 'Sign off release', caps?.canSignOff),
    button('hold', 'Place on hold', caps?.canHold),
    button('reauthorize', caps?.isLicensedSigner && release?.allPrerequisitesMet ? 'Reauthorize release' : 'Request reauthorization', caps?.canReauthorize),
    button('withdraw', 'Withdraw request', caps?.canWithdraw),
    button('correct', 'Correct a sign-off', caps?.canCorrect),
  ].filter(Boolean);

  return (
    <div data-testid="release-workflow">
      <p className={styles.service}>
        <Badge variant={status === 'on_hold' ? 'danger' : status === 'released' || status === 'reauthorized' ? 'success' : status === 'not_released' ? 'neutral' : 'warning'}>
          {RELEASE_STATUS_LABEL[status]}
        </Badge>
      </p>

      {release?.hold && (
        <p className={styles.notice} role="note" data-testid="release-hold">
          On hold{release.hold.reason ? `: ${release.hold.reason}` : ''} — {release.hold.byName ?? 'staff'}, {formatWhen(release.hold.at)}. Nothing may be sent to the crematory until it is reauthorized.
          {release.hold.paperworkAlreadyTransmitted && (
            <strong data-testid="release-hold-contact-crematory">
              {' '}
              The crematory already has (or may have) the paperwork. Contact the crematory now — a hold in SOLIS does not recall anything that was sent.
            </strong>
          )}
        </p>
      )}

      {confirming === null ? (
        buttons.length > 0 ? (
          <span className={styles.controls}>{buttons}</span>
        ) : (
          !release?.released &&
          status !== 'on_hold' && (
            <button type="button" className={styles.releaseButton} disabled>
              Release for cremation
            </button>
          )
        )
      ) : (
        <div role="group" aria-label="Confirm">
          <p className={styles.note}>
            {confirming === 'hold'
              ? 'Placing the release on hold stops anything being sent to the crematory. Say why.'
              : confirming === 'withdraw'
                ? 'This withdraws the request awaiting sign-off. It stays in the history.'
                : confirming === 'correct'
                  ? 'A correction is added to the history; the sign-off itself is never changed. If it is the sign-off in force, the release goes on hold and must be reauthorized with a licensed sign-off.'
                  : confirming === 'sign_off' || ((confirming === 'release' || confirming === 'reauthorize') && caps?.isLicensedSigner && release?.allPrerequisitesMet)
                ? `You are signing off the release for cremation after the ${serviceName.toLowerCase()} as the approving funeral director. It is recorded with your name and license.`
                : "This records a request. A licensed, authorized funeral director's sign-off is still required."}
          </p>
          {confirming === 'correct' && correctable.length > 1 && (
            <label className={styles.detail}>
              <span>Sign-off to correct</span>
              <select value={correcting} onChange={(e) => setCorrectsEventId(e.target.value)}>
                {correctable.map((e) => (
                  <option key={e.eventId} value={e.eventId}>
                    {EVENT_LABEL[e.type]} — {e.actorName ?? 'staff'}, {formatWhen(e.at)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(needsReason || confirming === 'withdraw') && (
            <label className={styles.detail}>
              <span>{confirming === 'hold' ? 'Reason for the hold' : confirming === 'correct' ? 'Reason for the correction' : 'Reason (optional)'}</span>
              <TextField value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required={needsReason} />
            </label>
          )}
          {error && (
            <p className="sx-form-banner sx-form-banner-error" role="alert">
              {error}
            </p>
          )}
          <span className={styles.controls}>
            <button
              type="button"
              className={styles.releaseButton}
              disabled={isSaving || (needsReason && !reason.trim())}
              onClick={() =>
                onAction(
                  {
                    action: confirming,
                    ...(needsReason || (confirming === 'withdraw' && reason.trim()) ? { reason } : {}),
                    ...(confirming === 'correct' ? { correctsEventId: correcting } : {}),
                  },
                  done,
                )
              }
            >
              {isSaving ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" className={styles.linkButton} disabled={isSaving} onClick={done}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {!release?.active && <p className={styles.note}>{release?.unavailableReason ?? RELEASE_FOR_CREMATION_UNAVAILABLE_REASON}</p>}
      {release?.active && status === 'not_released' && !release.casePrerequisitesMet && <p className={styles.note}>Every requirement above must be met first.</p>}

      {events.length > 0 && (
        <ol className={styles.requirements} data-testid="release-history">
          {[...events].reverse().map((e) => (
            <li key={e.eventId}>
              {EVENT_LABEL[e.type]} — {e.actorName ?? 'staff'}, {formatWhen(e.at)}
              {e.reason ? <span className={styles.itemHint}> — {e.reason}</span> : null}
              {e.approval ? (
                <span className={styles.itemHint}>
                  {' '}
                  — {e.approval.licenseState} license {e.approval.licenseNumber}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
