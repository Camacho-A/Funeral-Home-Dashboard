'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import textAreaFieldStyles from '@/components/ui/TextArea.module.css';
import type { CaseLogEntry, NewCaseLogEntryClientInput } from '@/types/caseLogEntry';
import { formatTimestamp } from '@/utils/format';
import { caseLogContactProblems, caseLogEntryDisplay } from '@/domain/cases/caseLogDisplay';
import styles from './CaseLogCard.module.css';

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
  onAddEntry,
  onPrint,
}: {
  entries: CaseLogEntry[];
  /** No `author` here (2026-10): attribution is resolved server-side from
      the authenticated caller, so this card neither knows nor claims who
      wrote an entry. It previously passed the case's ASSIGNED OWNER,
      which is why entries were credited to the wrong person — and to the
      literal "Office" on any unassigned case. */
  onAddEntry: (input: NewCaseLogEntryClientInput, options: AddCaseLogEntryOptions) => void;
  onPrint: () => void;
}) {
  const [logType, setLogType] = useState<'note' | 'contact'>('note');
  const [noteText, setNoteText] = useState('');
  const [contactWho, setContactWho] = useState('');
  const [contactSummary, setContactSummary] = useState('');
  // Inline validation (2026-10): shown once staff try to add the entry, or
  // leave the Contacted field empty.
  const [attempted, setAttempted] = useState(false);
  const [whoTouched, setWhoTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Autofocus the note editor whenever it's the active tab — including on
  // first mount, since "note" is the default tab (Phase 17). `preventScroll`
  // (item #9, 2026-09) stops the browser's default focus behavior from
  // dragging the whole page's scroll position down to this textarea on
  // every fresh Case Detail mount — this card sits well below the fold —
  // while still focusing it (cursor ready to type) exactly as before.
  useEffect(() => {
    if (logType === 'note') noteInputRef.current?.focus({ preventScroll: true });
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
        { type: 'note', text },
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

    // Both required (2026-10): who was contacted and a summary. A missing
    // one is shown inline rather than silently ignoring the click.
    const who = contactWho.trim();
    const summary = contactSummary.trim();
    setAttempted(true);
    if (!who || !summary) return;
    setIsSaving(true);
    onAddEntry(
      { type: 'contact', contactedWho: who, contactSummary: summary },
      {
        onSuccess: (entry) => {
          setIsSaving(false);
          setContactWho('');
          setContactSummary('');
          setAttempted(false);
          setWhoTouched(false);
          setJustAddedId(entry.id);
        },
        onError: () => {
          setIsSaving(false);
          setSaveFailed(true);
        },
      },
    );
  }

  // A note needs text before it can be added. A contact entry can always be
  // attempted, so a missing field is explained inline instead of the button
  // simply staying grey.
  const canSave = logType === 'note' ? noteText.trim() !== '' : true;
  const contactProblems = caseLogContactProblems({ contactedWho: contactWho, contactSummary });
  const whoError = (attempted || whoTouched) && contactProblems.contactedWho ? contactProblems.contactedWho : null;
  const summaryError = attempted && contactProblems.contactSummary ? contactProblems.contactSummary : null;

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
        kin — who was contacted, what was said, and when.
      </div>

      <div className={styles.entries}>
        {entries.length === 0 ? (
          <EmptyState message="No case log entries yet — add a note or logged call below." />
        ) : (
          entries.map((entry) => {
            const { headline, body } = caseLogEntryDisplay(entry);
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
          {/* Free text, so a specific person's name can be entered; never
              pre-filled. */}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="case-log-contacted">
              Contacted <span className={styles.requiredMark} aria-hidden="true">*</span>
            </label>
            <TextField
              id="case-log-contacted"
              value={contactWho}
              onChange={(e) => setContactWho(e.target.value)}
              onBlur={() => setWhoTouched(true)}
              placeholder="e.g. Catherine (next of kin), Dr. Lee, ME's office, crematory"
              aria-required="true"
              aria-invalid={whoError ? 'true' : undefined}
              aria-describedby={whoError ? 'case-log-contacted-error' : undefined}
            />
            {whoError && (
              <div id="case-log-contacted-error" className={styles.fieldError}>
                {whoError}
              </div>
            )}
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="case-log-summary">
              Summary <span className={styles.requiredMark} aria-hidden="true">*</span>
            </label>
            <textarea
              id="case-log-summary"
              className={textAreaFieldStyles.field}
              value={contactSummary}
              onChange={(e) => setContactSummary(e.target.value)}
              placeholder="e.g. left voicemail, no answer, confirmed pickup window"
              aria-required="true"
              aria-invalid={summaryError ? 'true' : undefined}
              aria-describedby={summaryError ? 'case-log-summary-error' : undefined}
            />
            {summaryError && (
              <div id="case-log-summary-error" className={styles.fieldError}>
                {summaryError}
              </div>
            )}
          </div>
        </>
      )}

      {saveFailed && (
        <div className={styles.saveError} role="alert">
          Couldn&apos;t save that entry — please try again.
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleAddEntry} disabled={isSaving || !canSave}>
          {isSaving ? 'Saving…' : 'Add entry'}
        </Button>
      </div>
    </div>
  );
}
