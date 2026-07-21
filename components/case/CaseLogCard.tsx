'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import type { CaseLogEntry, NewCaseLogEntryInput } from '@/types/caseLogEntry';
import { formatTimestamp } from '@/utils/format';
import styles from './CaseLogCard.module.css';

function entrySummary(entry: CaseLogEntry): { headline: string | null; body: string | null } {
  if (entry.type === 'contact') {
    return {
      headline: `Called ${entry.contactedWho} — spoke with ${entry.contactedSpoke}`,
      body: entry.contactSummary,
    };
  }
  return { headline: null, body: entry.text };
}

/**
 * Note/Contact tab selection and the in-progress draft are local UI state —
 * nothing outside this card needs them, so they aren't lifted to the page.
 * Submitting calls onAddEntry with a resolved NewCaseLogEntryInput; the page
 * supplies `author` indirectly by having useCaseLog's mutation already
 * scoped to the case, but the actual author name (effectiveOwnerName) is
 * threaded in as a prop rather than looked up here, keeping this
 * presentational.
 */
export function CaseLogCard({
  entries,
  authorName,
  onAddEntry,
  onPrint,
}: {
  entries: CaseLogEntry[];
  authorName: string;
  onAddEntry: (input: NewCaseLogEntryInput) => void;
  onPrint: () => void;
}) {
  const [logType, setLogType] = useState<'note' | 'contact'>('note');
  const [noteText, setNoteText] = useState('');
  const [contactWho, setContactWho] = useState('');
  const [contactSpoke, setContactSpoke] = useState('');
  const [contactSummary, setContactSummary] = useState('');

  function handleAddEntry() {
    if (logType === 'note') {
      const text = noteText.trim();
      if (!text) return;
      onAddEntry({ type: 'note', text, author: authorName });
      setNoteText('');
    } else {
      const who = contactWho.trim();
      const spoke = contactSpoke.trim();
      if (!who || !spoke) return;
      onAddEntry({
        type: 'contact',
        contactedWho: who,
        contactedSpoke: spoke,
        contactSummary: contactSummary.trim(),
        author: authorName,
      });
      setContactWho('');
      setContactSpoke('');
      setContactSummary('');
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Case Log</div>
        <button type="button" className={styles.printLink} onClick={onPrint}>
          Print
        </button>
      </div>
      <div className={styles.description}>
        Preferences and special requests, plus every call to the ME, doctor&apos;s office, or next of
        kin — who was contacted, who you spoke with, and when.
      </div>

      <div className={styles.entries}>
        {entries.map((entry) => {
          const { headline, body } = entrySummary(entry);
          return (
            <div key={entry.id} className={styles.entry}>
              {headline && <div className={styles.entryHeadline}>{headline}</div>}
              {body && <div className={styles.entryBody}>{body}</div>}
              <div className={styles.entryMeta}>
                {entry.author} · {formatTimestamp(entry.createdAt)}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${logType === 'note' ? styles.tabActive : styles.tabInactive}`}
          onClick={() => setLogType('note')}
        >
          Note
        </button>
        <button
          type="button"
          className={`${styles.tab} ${logType === 'contact' ? styles.tabActive : styles.tabInactive}`}
          onClick={() => setLogType('contact')}
        >
          Contact
        </button>
      </div>

      {logType === 'note' ? (
        <TextArea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="e.g. Family requested a biodegradable urn. Mail death certificate copy to next of kin."
        />
      ) : (
        <>
          <div className={styles.contactRow}>
            <TextField
              value={contactWho}
              onChange={(e) => setContactWho(e.target.value)}
              placeholder="Contacted — e.g. ME's office"
            />
            <TextField
              value={contactSpoke}
              onChange={(e) => setContactSpoke(e.target.value)}
              placeholder="Spoke with — name"
            />
          </div>
          <TextArea
            value={contactSummary}
            onChange={(e) => setContactSummary(e.target.value)}
            placeholder="Summary (optional)"
          />
        </>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleAddEntry}>
          Add entry
        </Button>
      </div>
    </div>
  );
}
