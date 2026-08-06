'use client';

import { use } from 'react';
import { useFamilyDocuments } from '@/hooks/useFamilyPortal';
import { buildFamilyDocumentDownloadUrl } from '@/lib/familyClient';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from '@/components/family/FamilyCaseSection.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). Only documents that
 * are both `familyVisible: true` and `status: 'active'` ever appear here
 * — see `services/portal/portalDocumentService.ts`'s own fail-closed
 * filter; this page has no way to request anything beyond what that
 * service already returned.
 */
export default function FamilyDocumentsPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const documentsQuery = useFamilyDocuments(caseId);

  if (documentsQuery.isPending) return <p className={styles.loading}>Loading documents…</p>;
  if (documentsQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load documents. Please try again.</p>;

  const documents = documentsQuery.data ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Documents</h1>
      <FamilyCaseNav caseId={caseId} />

      {documents.length === 0 ? (
        <EmptyState message="No documents have been shared with you yet." />
      ) : (
        <Card className={styles.listCard}>
          {documents.map((doc) => (
            <div key={doc.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.title}>{doc.fileName}</span>
                <span className={styles.meta}>{formatTimestamp(doc.createdAt)}</span>
              </div>
              <div className={styles.actions}>
                <a href={buildFamilyDocumentDownloadUrl(caseId, doc.id)}>
                  <Button variant="secondary">Download</Button>
                </a>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
