'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  useUnmatchedSubmissions,
  useLinkSubmissionToCase,
  useDismissSubmission,
  useExternalFormConfigs,
} from '@/hooks/useExternalForms';
import { useCases } from '@/hooks/useCases';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';
import { CreateCaseFromSubmissionDialog } from './CreateCaseFromSubmissionDialog';
import styles from './UnmatchedFormsPanel.module.css';

/**
 * Manors Jotform integration (case-first architecture, 2026-09).
 *
 * Create Case (2026-10): this page can now also open a NEW case from a
 * submission. Case-number allocation is still never performed here — the
 * action calls the same server-side intake path the webhook uses.
 *
 * IDENTIFIABLE ROWS (2026-10). A row used to render only the provider's
 * numeric form id ("261945978664175") and a timestamp — no decedent name
 * anywhere. Staff looking for a specific person could not tell what they
 * were looking at, and reasonably concluded a submission was missing when
 * it was sitting in front of them. Every row now leads with the decedent
 * name from the submission's own mapped fields, plus date of death and
 * the form's human name.
 *
 * The values shown come from `mappedFields`, which is a CACHE of the
 * mapping computed at receipt. It is the right thing to show in a list —
 * it is what SOLIS actually recorded — but it is deliberately not what
 * creation uses: the Create Case flow re-fetches and re-verifies the
 * answers from Jotform first.
 */

/** Best-effort read of the cached mapping. A malformed or empty value
    must degrade to "unnamed", never blank the whole row or throw. */
function readMappedFields(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/**
 * Automatic intake failure visibility (2026-10). Turns the service's
 * machine reason into something a funeral director can act on. An
 * unrecognised reason is shown verbatim rather than hidden — an
 * unexplained row is exactly the problem this solves, so an unfamiliar
 * code is still better than silence.
 */
function describeCaseCreationFailure(reason: string): string {
  if (reason.startsWith('missing_required_fields')) {
    const fields = reason.split(':')[1] ?? '';
    return `The submission did not carry ${fields.split(',').join(', ') || 'the required fields'}, which a case cannot be opened without. Link it to an existing case, or use Create Case once you can supply them.`;
  }
  if (reason === 'duplicate_review_required') {
    return 'It looks like a case SOLIS already has, so nothing was created and nothing was merged. Check the existing case first — if it is the same person, link this submission to it.';
  }
  if (reason === 'already_claimed') {
    return 'Another delivery of this same submission was already creating a case.';
  }
  if (reason === 'no_active_staff_profile') {
    return 'This organization has no active staff profile to attribute an intake case to.';
  }
  if (reason.startsWith('case_creation_failed')) {
    return 'Creating the case failed. Use Create Case to try again.';
  }
  return reason;
}

export function UnmatchedFormsPanel() {
  const { organizationId } = useOrganization();
  const submissionsQuery = useUnmatchedSubmissions(organizationId);
  const configsQuery = useExternalFormConfigs(organizationId, true);
  const linkMutation = useLinkSubmissionToCase(organizationId);
  const [searchingSubmissionId, setSearchingSubmissionId] = useState<string | null>(null);
  const [creatingSubmissionId, setCreatingSubmissionId] = useState<string | null>(null);
  // No action needed (2026-10): the submission being cleared, with the
  // name shown in the confirmation.
  const [dismissing, setDismissing] = useState<{ id: string; name: string } | null>(null);
  const dismissMutation = useDismissSubmission(organizationId);
  const [searchQuery, setSearchQuery] = useState('');
  const casesQuery = useCases({ searchQuery });

  const submissions = submissionsQuery.data ?? [];

  /** Provider form id -> the form's human name. */
  const labelByFormId = useMemo(() => {
    const map = new Map<string, string>();
    for (const config of configsQuery.data ?? []) map.set(config.externalFormId, config.label);
    return map;
  }, [configsQuery.data]);

  if (submissionsQuery.isPending) return <p>Loading…</p>;

  // Distinguished from "nothing to show". A failure here used to render
  // the empty state, so a permission or connectivity problem was
  // indistinguishable from an genuinely empty queue — and silently
  // implied that no submission needed attention.
  if (submissionsQuery.isError) {
    return (
      <div className={styles.errorState} role="alert">
        <p>Unmatched forms could not be loaded, so this list may be incomplete.</p>
        <p className={styles.errorDetail}>
          {submissionsQuery.error instanceof Error ? submissionsQuery.error.message : 'Unknown error.'}
        </p>
        <Button variant="secondary" onClick={() => submissionsQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (submissions.length === 0) return <EmptyState message="No unmatched form submissions." />;

  return (
    <div className={styles.list}>
      {submissions.map((submission) => {
        const fields = readMappedFields(submission.mappedFields);
        const decedentName = fields.decedentName?.trim();
        const formLabel = labelByFormId.get(submission.externalFormId);

        return (
          <div key={submission.id} className={styles.item}>
            <div className={styles.itemHeader}>
              <strong className={styles.decedentName}>
                {decedentName || <span className={styles.unnamed}>No name on this submission</span>}
              </strong>
              <span className={styles.meta}>Received {formatTimestamp(submission.receivedAt)}</span>
            </div>

            {submission.caseCreationFailureReason && (
              <p className={styles.failureReason} role="note">
                <strong>Automatic case creation did not run.</strong>{' '}
                {describeCaseCreationFailure(submission.caseCreationFailureReason)}
              </p>
            )}

            <div className={styles.details}>
              {fields.dateOfDeath && <span>Date of death {fields.dateOfDeath}</span>}
              {/* Falls back to the provider id if the form's config is
                  unavailable — better a raw id than nothing at all. */}
              <span>{formLabel ?? submission.externalFormId}</span>
              <span className={styles.submissionId}>Submission {submission.externalSubmissionId}</span>
            </div>

            {searchingSubmissionId === submission.id ? (
              <div>
                <TextField
                  aria-label="Search SOLIS case"
                  placeholder="Search by case number or decedent name…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className={styles.results}>
                  {(casesQuery.data ?? []).map((match) => (
                    <div key={match.id} className={styles.resultRow}>
                      <span>
                        {match.caseNumber} — {match.decedentName}
                      </span>
                      <Button
                        onClick={() => linkMutation.mutate({ submissionId: submission.id, caseId: match.id })}
                        disabled={linkMutation.isPending}
                      >
                        Link to Case
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" onClick={() => setSearchingSubmissionId(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className={styles.linkRow}>
                <Button variant="secondary" onClick={() => setSearchingSubmissionId(submission.id)}>
                  Search existing SOLIS case
                </Button>
                {/* Eligibility is decided server-side; the dialog explains
                    it if this submission's form is not permitted to create. */}
                <Button onClick={() => setCreatingSubmissionId(submission.id)}>Create Case</Button>
                {/* For a submission staff have checked and that needs
                    nothing (e.g. the case already has it). Confirmed first. */}
                <Button variant="ghost" onClick={() => setDismissing({ id: submission.id, name: decedentName || 'this submission' })}>
                  No action needed
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <ConfirmActionDialog
        open={dismissing !== null}
        onClose={() => setDismissing(null)}
        title="Clear from Unmatched Forms?"
        message={`Use this when ${dismissing?.name ?? 'this submission'} needs no action — for example, the existing case already has this form. It is removed from this list only: nothing is deleted, no case is created or changed, and the submission stays on record in the activity log.`}
        confirmLabel="Clear — no action needed"
        onConfirm={async () => {
          await dismissMutation.mutateAsync(dismissing!.id);
          setDismissing(null);
        }}
      />

      <CreateCaseFromSubmissionDialog
        organizationId={organizationId}
        submissionId={creatingSubmissionId}
        onClose={() => setCreatingSubmissionId(null)}
      />
    </div>
  );
}
