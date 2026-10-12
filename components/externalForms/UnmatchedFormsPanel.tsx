'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useUnmatchedSubmissions, useLinkSubmissionToCase } from '@/hooks/useExternalForms';
import { CreateCaseFromSubmissionDialog } from './CreateCaseFromSubmissionDialog';
import { useCases } from '@/hooks/useCases';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from './UnmatchedFormsPanel.module.css';

/**
 * Manors Jotform integration (case-first architecture, 2026-09).
 *
 * Create Case (2026-10): this page can now also open a NEW case from a
 * submission, which it deliberately could not before. That changed
 * because either the First Call Sheet or the Arrangement Forms can
 * legitimately be the first thing SOLIS hears about a death, and
 * historical submissions that predate that fix are still sitting here
 * with no case to attach to.
 *
 * Case-number allocation is still never performed on this page: the
 * action calls the same server-side intake path the webhook uses, which
 * goes through POST /api/cases like everything else. Every eligibility,
 * ownership, authorization and duplicate check is re-run server-side —
 * nothing here is trusted.
 */
export function UnmatchedFormsPanel() {
  const { organizationId } = useOrganization();
  const submissionsQuery = useUnmatchedSubmissions(organizationId);
  const linkMutation = useLinkSubmissionToCase(organizationId);
  const [searchingSubmissionId, setSearchingSubmissionId] = useState<string | null>(null);
  const [creatingSubmissionId, setCreatingSubmissionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const casesQuery = useCases({ searchQuery });

  const submissions = submissionsQuery.data ?? [];

  if (submissionsQuery.isPending) return <p>Loading…</p>;
  if (submissions.length === 0) return <EmptyState message="No unmatched form submissions." />;

  return (
    <div className={styles.list}>
      {submissions.map((submission) => (
        <div key={submission.id} className={styles.item}>
          <div className={styles.itemHeader}>
            <strong>{submission.externalFormId}</strong>
            <span className={styles.meta}>Received {formatTimestamp(submission.receivedAt)}</span>
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
            </div>
          )}
        </div>
      ))}

      <CreateCaseFromSubmissionDialog
        organizationId={organizationId}
        submissionId={creatingSubmissionId}
        onClose={() => setCreatingSubmissionId(null)}
      />
    </div>
  );
}
