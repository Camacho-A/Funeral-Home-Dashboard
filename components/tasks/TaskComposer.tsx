'use client';

import { useState, type KeyboardEvent } from 'react';
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
 * submit behavior). Same handler and reset. Task assignment (2026-10):
 * "Unassigned" is a real choice and the default assignee is the caller.
 */
export function TaskComposer({
  staffOptions,
  caseOptions,
  myStaffId = null,
  canAssign = true,
  onAddTask,
}: {
  staffOptions: StaffOption[];
  caseOptions: CaseOption[];
  /** The caller's own StaffProfile id — the default assignee (2026-10). */
  myStaffId?: string | null;
  /** Without task.assign a new task is created unassigned (the server
      refuses an assignee from such a caller anyway). */
  canAssign?: boolean;
  onAddTask: (input: { text: string; assigneeStaffId: string | null; caseId: string | null }) => void;
}) {
  const [text, setText] = useState('');
  // undefined = not chosen yet; null = Unassigned (a real choice, 2026-10).
  const [chosenAssignee, setChosenAssignee] = useState<string | null | undefined>(undefined);
  const [caseId, setCaseId] = useState<string | null>(null);

  // Task assignment (2026-10): a new task defaults to the person adding it
  // ("Assign to me") once staff have loaded — or Unassigned when they have
  // no staff profile — never to whoever happens to be first in the list.
  const me = myStaffId ? staffOptions.find((staff) => staff.id === myStaffId) : undefined;
  const assigneeStaffId = !canAssign ? null : chosenAssignee !== undefined ? chosenAssignee : (me?.id ?? null);

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
    <div className="sx-composer" data-can-assign={canAssign || undefined}>
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
      {canAssign && (
        <SelectField
          className="sx-select"
          value={assigneeStaffId ?? ''}
          onChange={(e) => setChosenAssignee(e.target.value || null)}
          aria-label="Assignee"
        >
          <option value="">Unassigned</option>
          {me && <option value={me.id}>{me.name} (me)</option>}
          {staffOptions
            .filter((staff) => staff.id !== me?.id)
            .map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
        </SelectField>
      )}
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
