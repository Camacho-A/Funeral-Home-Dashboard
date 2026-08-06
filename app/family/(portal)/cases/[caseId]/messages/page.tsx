'use client';

import { use, useState } from 'react';
import { useFamilyMessages, useSendFamilyMessage } from '@/hooks/useFamilyPortal';
import { FamilyCaseNav } from '@/components/family/FamilyCaseNav';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from '@/components/family/FamilyCaseSection.module.css';

const MAX_BODY_LENGTH = 5000;

/**
 * Phase 29 (Family Portal & External Collaboration). A single, immutable
 * insert-only thread with this case's staff team — no editing, deletion,
 * or live typing indicators exist anywhere in this surface.
 */
export default function FamilyMessagesPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const messagesQuery = useFamilyMessages(caseId);
  const sendMessage = useSendFamilyMessage(caseId);

  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (messagesQuery.isPending) return <p className={styles.loading}>Loading messages…</p>;
  if (messagesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load messages. Please try again.</p>;

  const messages = messagesQuery.data ?? [];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!body.trim()) return;
    try {
      await sendMessage.mutateAsync(body.trim());
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Messages</h1>
      <FamilyCaseNav caseId={caseId} />

      {messages.length === 0 ? (
        <EmptyState message="No messages yet. Send one below to reach the staff team." />
      ) : (
        <Card className={styles.listCard}>
          {messages.map((message) => (
            <div key={message.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.title}>{message.senderType === 'staff' ? 'Staff' : 'You'}</span>
                <span className={styles.meta}>{formatTimestamp(message.createdAt)}</span>
                <span>{message.body}</span>
              </div>
            </div>
          ))}
        </Card>
      )}

      <form className={styles.messageForm} onSubmit={handleSubmit}>
        <TextArea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message to the staff team…" maxLength={MAX_BODY_LENGTH} rows={3} />
        {error && <span className={styles.errorText}>{error}</span>}
        <Button type="submit" disabled={!body.trim() || sendMessage.isPending}>
          Send
        </Button>
      </form>
    </div>
  );
}
