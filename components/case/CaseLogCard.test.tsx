import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CaseLogCard, type AddCaseLogEntryOptions } from './CaseLogCard';
import type { CaseLogEntry, NewCaseLogEntryInput } from '@/types/caseLogEntry';

const ENTRY: CaseLogEntry = {
  id: 'log-1',
  organizationId: 'managed-cremations',
  caseId: 'case-1',
  type: 'note',
  text: 'Existing note',
  contactedWho: null,
  contactedSpoke: null,
  contactSummary: null,
  author: 'Dana',
  createdAt: '2026-07-20T00:00:00.000Z',
};

function renderCard({
  entries = [],
  onAddEntry = vi.fn(),
}: {
  entries?: CaseLogEntry[];
  onAddEntry?: (input: NewCaseLogEntryInput, options: AddCaseLogEntryOptions) => void;
} = {}) {
  const onPrint = vi.fn();
  const utils = render(
    <CaseLogCard entries={entries} authorName="Dana" onAddEntry={onAddEntry} onPrint={onPrint} />,
  );
  return { ...utils, onAddEntry, onPrint };
}

describe('CaseLogCard — note editor autofocus and shortcut (Phase 17)', () => {
  it('autofocuses the note textarea on mount, since Note is the default tab', () => {
    renderCard({ entries: [ENTRY] });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);
    expect(textarea).toHaveFocus();
  });

  it('refocuses the note textarea when switching back to the Note tab', () => {
    renderCard({ entries: [ENTRY] });
    fireEvent.click(screen.getByRole('button', { name: 'Contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);
    expect(textarea).toHaveFocus();
  });

  it('saves the note on Ctrl+Enter without clicking "Add entry"', () => {
    const onAddEntry = vi.fn();
    renderCard({ onAddEntry });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);

    fireEvent.change(textarea, { target: { value: 'Quick note' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onAddEntry).toHaveBeenCalledWith(
      { type: 'note', text: 'Quick note', author: 'Dana' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('saves on Cmd+Enter (metaKey) too', () => {
    const onAddEntry = vi.fn();
    renderCard({ onAddEntry });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);

    fireEvent.change(textarea, { target: { value: 'Quick note' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(onAddEntry).toHaveBeenCalled();
  });
});

describe('CaseLogCard — clear/scroll only after a confirmed save (Phase 17)', () => {
  it('does not clear the textarea until onSuccess fires — no optimistic clear', () => {
    const onAddEntry = vi.fn(); // never calls options.onSuccess itself
    renderCard({ onAddEntry });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);

    fireEvent.change(textarea, { target: { value: 'Pending note' } });
    fireEvent.click(screen.getByRole('button', { name: /add entry|saving/i }));

    expect(textarea).toHaveValue('Pending note');
  });

  it('clears the textarea once the save actually succeeds', async () => {
    const onAddEntry = vi.fn((input: NewCaseLogEntryInput, options: AddCaseLogEntryOptions) => {
      options.onSuccess({ ...ENTRY, id: 'log-new', text: input.text ?? null });
    });
    renderCard({ onAddEntry });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);

    fireEvent.change(textarea, { target: { value: 'Saved note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('keeps the typed text and shows an error if the save fails', async () => {
    const onAddEntry = vi.fn((_input: NewCaseLogEntryInput, options: AddCaseLogEntryOptions) => {
      options.onError();
    });
    renderCard({ onAddEntry });
    const textarea = screen.getByPlaceholderText(/family requested a biodegradable urn/i);

    fireEvent.change(textarea, { target: { value: 'Failed note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save/i));
    expect(textarea).toHaveValue('Failed note');
  });
});

describe('CaseLogCard — entries and empty state', () => {
  it('shows an empty state when there are no entries yet', () => {
    renderCard({ entries: [] });
    expect(screen.getByText(/no case log entries yet/i)).toBeInTheDocument();
  });

  it('renders entries in whatever order it is given (sorting is the caller\'s job)', () => {
    const older: CaseLogEntry = { ...ENTRY, id: 'log-a', text: 'Older', createdAt: '2026-07-01T00:00:00.000Z' };
    const newer: CaseLogEntry = { ...ENTRY, id: 'log-b', text: 'Newer', createdAt: '2026-07-20T00:00:00.000Z' };
    renderCard({ entries: [newer, older] });

    const bodies = screen.getAllByText(/Older|Newer/).map((el) => el.textContent);
    expect(bodies).toEqual(['Newer', 'Older']);
  });
});
