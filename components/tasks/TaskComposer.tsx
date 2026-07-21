'use client';

import { useEffect, useState } from 'react';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { Button } from '@/components/ui/Button';
import styles from './TaskComposer.module.css';

export type StaffOption = { id: string; name: string };
export type CaseOption = { id: string; name: string };

/**
 * The draft text/assignee/linked-case selection is local UI state — nothing
 * outside this card needs it. `staffOptions`/`caseOptions` are supplied by
 * the page (via useStaff/useCases) since sourcing that data isn't this
 * component's job; submitting calls onAddTask with a resolved input.
 */
export function TaskComposer({
  staffOptions,
  caseOptions,
  onAddTask,
}: {
  staffOptions: StaffOption[];
  caseOptions: CaseOption[];
  onAddTask: (input: { text: string; assigneeStaffId: string | null; caseId: string | null }) => void;
}) {
  const [text, setText] = useState('');
  const [assigneeStaffId, setAssigneeStaffId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  // staffOptions loads asynchronously (useStaff, Phase 4) — default to the
  // first staff member once it arrives, matching design/support.js's
  // `taskDraftAssignee: DEFAULT_STAFF[0]`, without overriding a choice the
  // user already made.
  useEffect(() => {
    if (assigneeStaffId === null && staffOptions.length > 0) {
      setAssigneeStaffId(staffOptions[0].id);
    }
  }, [assigneeStaffId, staffOptions]);

  function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddTask({ text: trimmed, assigneeStaffId, caseId });
    setText('');
    setCaseId(null);
  }

  return (
    <div className={styles.composer}>
      <TextField
        className={styles.textInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a follow-up, reminder, or to-do…"
      />
      <SelectField
        value={assigneeStaffId ?? ''}
        onChange={(e) => setAssigneeStaffId(e.target.value || null)}
      >
        {staffOptions.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        className={styles.caseSelect}
        value={caseId ?? ''}
        onChange={(e) => setCaseId(e.target.value || null)}
      >
        <option value="">No linked case</option>
        {caseOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </SelectField>
      <Button onClick={handleAdd}>Add</Button>
    </div>
  );
}
