'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import textAreaFieldStyles from '@/components/ui/TextArea.module.css';
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

/** Passed through to `onAddEntry` as react-query's own per-call mutate
    options — CaseLogCard never touches the mutation itself, it just asks
    to be told whether *this* save succeeded so it can clear the draft and
    scroll to the new entry only once the write is confirmed (Phase 17),
    instead of the previous optimistic-clear-then-hope behavior. */
export type AddCaseLogEntryOptions = {
  onSuccess: (entry: CaseLogEntry) => void;
  onError: () => void;
};

/**
 * Note/Contact tab selection and the in-progress draft are local UI state —
 * nothing outside this card needs them, so they aren't lifted to the page.
 * `entries` is expected pre-sorted newest-first by the caller (Phase 17 —
 * see the page's own sort, shared with its Print callback so the two never
 * disagree on order); this card only renders in the order it's given.
 */
export function CaseLogCard({
  entries,
  authorName,
  onAddEntry,
  onPrint,
}: {
  entries: CaseLogEntry[];
  authorName: string;
  onAddEntry: (input: NewCaseLogEntryInput, options: AddCaseLogEntryOptions) => void;
  onPrint: () => void;
}) {
  const [logType, setLogType] = useState<'note' | 'contact'>('note');
  const [noteText, setNoteText] = useState('');
  const [contactWho, setContactWho] = useState('');
  const [contactSpoke, setContactSpoke] = useState('');
  const [contactSummary, setContactSummary] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Autofocus the note editor whenever it's the active tab — including on
  // first mount, since "note" is the default tab (Phase 17).
  useEffect(() => {
    if (logType === 'note') noteInputRef.current?.focus();
  }, [logType]);

  // Once a just-saved entry actually shows up in the (newest-first) list
  // the page hands down, scroll it into view.
  useEffect(() => {
    if (!justAddedId) return;
    entryRefs.current[justAddedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setJustAddedId(null);
  }, [justAddedId, entries]);

  function handleAddEntry() {
    setSaveFailed(false);

    if (logType === 'note') {
      const text = noteText.trim();
      if (!text) return;
      setIsSaving(true);
      onAddEntry(
        { type: 'note', text, author: authorName },
        {
          onSuccess: (entry) => {
            setIsSaving(false);
            setNoteText('');
            setJustAddedId(entry.id);
          },
          onError: () => {
            setIsSaving(false);
            setSaveFailed(true);
          },
        },
      );
      return;
    }

    const who = contactWho.trim();
    const spoke = contactSpoke.trim();
    if (!who || !spoke) return;
    setIsSaving(true);
    onAddEntry(
      {
        type: 'contact',
        contactedWho: who,
        contactedSpoke: spoke,
        contactSummary: contactSummary.trim(),
        author: authorName,
      },
      {
        onSuccess: (entry) => {
          setIsSaving(false);
          setContactWho('');
          setContactSpoke('');
          setContactSummary('');
          setJustAddedId(entry.id);
        },
        onError: () => {
          setIsSaving(false);
          setSaveFailed(true);
        },
      },
    );
  }

  function handleNoteKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleAddEntry();
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
        {entries.length === 0 ? (
          <EmptyState message="No case log entries yet — add a note or logged call below." />
        ) : (
          entries.map((entry) => {
            const { headline, body } = entrySummary(entry);
            return (
              <div
                key={entry.id}
                ref={(el) => {
                  entryRefs.current[entry.id] = el;
                }}
                className={styles.entry}
              >
                {headline && <div className={styles.entryHeadline}>{headline}</div>}
                {body && <div className={styles.entryBody}>{body}</div>}
                <div className={styles.entryMeta}>
                  {entry.author} · {formatTimestamp(entry.createdAt)}
                </div>
              </div>
            );
          })
        )}
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
        <textarea
          ref={noteInputRef}
          className={textAreaFieldStyles.field}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={handleNoteKeyDown}
          placeholder="e.g. Family requested a biodegradable urn. Mail death certificate copy to next of kin.  (⌘/Ctrl + Enter to save)"
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
          <textarea
            className={textAreaFieldStyles.field}
            value={contactSummary}
            onChange={(e) => setContactSummary(e.target.value)}
            placeholder="Summary (optional)"
          />
        </>
      )}

      {saveFailed && (
        <div className={styles.saveError} role="alert">
          Couldn&apos;t save that entry — please try again.
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleAddEntry} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Add entry'}
        </Button>
      </div>
    </div>
  );
}
