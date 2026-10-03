'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { Button } from '@/components/ui/Button';

export type StaffOption = { id: string; name: string };
export type CaseOption = { id: string; name: string };

/**
 * The draft text/assignee/linked-case selection is local UI state — nothing
 * outside this card needs it. `staffOptions`/`caseOptions` are supplied by
 * the page (via useStaff/useCases) since sourcing that data isn't this
 * component's job; submitting calls onAddTask with a resolved input.
 *
 * SOLIS Tasks/Calendar/Settings phase, §1.3: presentation only —
 * `.sx-composer` grid root, `sx-input`/`sx-select` controls, the button
 * relabeled "Add task" and restyled `sx-btn sx-btn-primary`, plus an Enter
 * handler on the text field (the field had none before — Enter just typed
 * a newline-less default; this is additive, not a change to an existing
 * submit behavior). Same handler, same default-assignee effect, same reset.
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

  function handleTextKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') handleAdd();
  }

  return (
    <div className="sx-composer">
      <TextField
        className="sx-input"
        value={text}
        // SOLIS-wide ALL-CAPS data standard (2026-09): UX-only — the
        // server (lib/wixTaskMapper.ts) normalizes authoritatively
        // regardless of what reaches it.
        onChange={(e) => setText(e.target.value.toUpperCase())}
        onKeyDown={handleTextKeyDown}
        placeholder="Add a follow-up, reminder, or to-do…"
        aria-label="Task"
      />
      <SelectField
        className="sx-select"
        value={assigneeStaffId ?? ''}
        onChange={(e) => setAssigneeStaffId(e.target.value || null)}
        aria-label="Assignee"
      >
        {staffOptions.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        className="sx-select"
        value={caseId ?? ''}
        onChange={(e) => setCaseId(e.target.value || null)}
        aria-label="Linked case"
      >
        <option value="">No linked case</option>
        {caseOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </SelectField>
      <Button className="sx-btn sx-btn-primary" onClick={handleAdd}>
        Add task
      </Button>
    </div>
  );
}
