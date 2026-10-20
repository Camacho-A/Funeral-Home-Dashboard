import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecordPickupDialog } from './RecordPickupDialog';

function renderDialog(suggestions: { role: string; name: string | null }[], onSave = vi.fn()) {
  render(
    <RecordPickupDialog open onClose={vi.fn()} initialReleasedTo={null} initialReleasedAt={null} initialNote={null} suggestions={suggestions} onSave={onSave} />,
  );
  return onSave;
}

describe('RecordPickupDialog — quick-fill names (2026-10)', () => {
  it('offers each person on the case once, skipping blanks', () => {
    renderDialog([
      { role: 'Next of kin', name: 'Karen Ellison' },
      { role: 'Arrangement contact', name: 'KAREN ELLISON' },
      { role: 'Arrangement contact', name: '  ' },
      { role: 'Other', name: null },
    ]);
    expect(screen.getAllByRole('button', { name: /: KAREN ELLISON$/ })).toHaveLength(1);
  });

  it('shows no quick-fill row when there is nobody to suggest', () => {
    renderDialog([]);
    expect(screen.queryByLabelText('Fill in Released to')).not.toBeInTheDocument();
  });

  it('a suggested name can still be edited before saving', () => {
    const onSave = renderDialog([{ role: 'Next of kin', name: 'Karen Ellison' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Next of kin: KAREN ELLISON' }));
    fireEvent.change(screen.getByLabelText('Released to'), { target: { value: 'MICHAEL ELLISON' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record pickup' }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ pickupStatus: 'released', pickupReleasedTo: 'MICHAEL ELLISON' });
  });
});
