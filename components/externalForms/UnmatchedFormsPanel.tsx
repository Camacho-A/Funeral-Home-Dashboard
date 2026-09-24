'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useUnmatchedSubmissions, useLinkSubmissionToCase } from '@/hooks/useExternalForms';
import { useCases } from '@/hooks/useCases';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from './UnmatchedFormsPanel.module.css';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). NOT a
 * general intake queue — this never creates a case. A submission lands
 * here only when its opaque link token was missing, invalid, or already
 * superseded (see app/api/webhooks/jotform/route.ts). Staff search for
 * and attach it to an EXISTING case; case-number allocation is never
 * touched by anything on this page.
 */
export function UnmatchedFormsPanel() {
  const { organizationId } = useOrganization();
  const submissionsQuery = useUnmatchedSubmissions(organizationId);
  const linkMutation = useLinkSubmissionToCase(organizationId);
  const [searchingSubmissionId, setSearchingSubmissionId] = useState<string | null>(null);
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
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
