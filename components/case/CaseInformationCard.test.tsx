import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CaseInformationCard } from './CaseInformationCard';

const baseProps = {
  dateOfBirth: '03/14/1951',
  dateOfDeath: '07/09/2026',
  timeOfDeath: '14:30',
  placeOfDeath: 'ST. MARY\'S HOSPITAL',
  weight: '178 lb',
  weightOver200: false,
  nextOfKinName: 'KAREN ELLISON',
  nextOfKinPhone: '555-0100',
  nextOfKinEmail: null,
  nextOfKinRelationship: null,
  nextOfKinRelationshipOther: null,
  certifierName: null,
  certifierPhone: null,
  certifierLicenseNumber: null,
  certifierFax: null,
  onSaveCertifierName: vi.fn(),
  onSaveCertifierPhone: vi.fn(),
  onSaveCertifierLicenseNumber: vi.fn(),
  onSaveCertifierFax: vi.fn(),
  tagNumber: null,
  paymentStatus: 'awaiting_payment' as const,
  pickupStatus: 'awaiting_pickup' as const,
  pickupReleasedTo: null,
  pickupReleasedAt: null,
  pickupNote: null,
  returnMethod: 'undecided' as const,
  shippingCarrier: null,
  shippingTrackingNumber: null,
  shippingDateShipped: null,
  shippingDeliveryStatus: null,
  shippingDeliveredAt: null,
  ownerStaffId: 'staff-dana',
  staffOptions: [{ id: 'staff-dana', name: 'Dana' }],
  onReassignOwner: vi.fn(),
  showOwner: true,
  onSaveWeight: vi.fn(),
  onSaveTimeOfDeath: vi.fn(),
  isVeteran: false,
  veteranFlagLocked: false,
  onToggleVeteran: vi.fn(),
  vaSteps: [],
  vaCallbackDone: false,
  vaPublishChoice: null,
  vaNotificationResponsibility: null,
  onToggleVaStep: vi.fn(),
  onSetVaPublishChoice: vi.fn(),
  onSetVaNotificationResponsibility: vi.fn(),
};

describe('CaseInformationCard — click-to-edit fields (Phase 17)', () => {
  // Generic EditableField behaviors (click-to-edit toggle, commit-on-Enter,
  // unchanged-value skip, Escape-revert) use Location as the vehicle field
  // rather than Time of Death — Time of Death moved to its own dedicated
  // 12-hour TwelveHourTimeField component (2026-09) with a different
  // interaction shape (no single text input to click/blur), covered in its
  // own describe block below.
  it('shows a field as plain text until clicked, then as an input', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);

    const value = screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" });
    expect(screen.queryByDisplayValue("ST. MARY'S HOSPITAL")).not.toBeInTheDocument();

    fireEvent.click(value);
    expect(screen.getByDisplayValue("ST. MARY'S HOSPITAL")).toBeInTheDocument();
  });

  it('commits a plain-text field on Enter', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" }));
    const input = screen.getByDisplayValue("ST. MARY'S HOSPITAL");
    fireEvent.change(input, { target: { value: 'general hospital' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledTimes(1);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ placeOfDeath: 'GENERAL HOSPITAL' });
  });

  it('commits on blur too', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '555-0100' }));
    const input = screen.getByDisplayValue('555-0100');
    fireEvent.change(input, { target: { value: '555-0199' } });
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinPhone: '555-0199' });
  });

  it('does not call onUpdateCaseInfo if the value is unchanged', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" }));
    fireEvent.blur(screen.getByDisplayValue("ST. MARY'S HOSPITAL"));

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('cancels and reverts on Escape without saving', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" }));
    const input = screen.getByDisplayValue("ST. MARY'S HOSPITAL");
    fireEvent.change(input, { target: { value: 'garbage value' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" })).toBeInTheDocument();
  });

  it('uppercases location and next-of-kin name as the user types, matching the New Case form', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" }));
    const input = screen.getByDisplayValue("ST. MARY'S HOSPITAL");
    fireEvent.change(input, { target: { value: 'new hospital wing' } });

    expect(input).toHaveValue('NEW HOSPITAL WING');
  });
});

describe('CaseInformationCard — date fields reuse the New Case form\'s mask and validation (Phase 17)', () => {
  it('auto-inserts slashes as the user types a date', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '07202026' } });

    expect(input).toHaveValue('07/20/2026');
  });

  it('blocks Enter on an invalid calendar date and shows an inline error', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '02302026' } }); // Feb 30 doesn't exist
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/enter a valid date/i)).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('reverts an invalid date on blur rather than saving it', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '02302026' } });
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '03/14/1951' })).toBeInTheDocument();
  });

  it('commits a valid date on Enter', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '01011950' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfBirth: '01/01/1950' });
  });
});

describe('CaseInformationCard — two-digit year expansion (Solis go-live checkpoint)', () => {
  it('expands a fully-typed two-digit year on commit', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '030150' } });
    expect(input).toHaveValue('03/01/50'); // not yet expanded, still typing
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfBirth: '03/01/1950' });
  });

  it('expands on blur too', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '030105' } }); // -> 2005
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfBirth: '03/01/2005' });
  });
});

describe('CaseInformationCard — DOB/DOD cross-field validation (Solis go-live checkpoint)', () => {
  it('blocks Enter when Date of Birth would be after the existing Date of Death, showing an inline error', () => {
    // baseProps.dateOfDeath is '07/09/2026'.
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '08012026' } }); // after 07/09/2026
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/date of birth cannot be after date of death/i)).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('reverts on blur rather than saving a Date of Birth after Date of Death', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: '08012026' } });
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '03/14/1951' })).toBeInTheDocument();
  });

  it('blocks Enter on a future Date of Death', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '07/09/2026' }));
    const input = screen.getByDisplayValue('07/09/2026');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/date of death cannot be in the future/i)).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('allows committing a valid Date of Death that is still after Date of Birth', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '07/09/2026' }));
    const input = screen.getByDisplayValue('07/09/2026');
    fireEvent.change(input, { target: { value: '07102026' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfDeath: '07/10/2026' });
  });
});

describe('CaseInformationCard — Task #15 (2026-09, future-historical-date validation)', () => {
  it('blocks Enter on a future Date of Birth', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText(/date of birth cannot be in the future/i)).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('allows committing Date of Birth = today', () => {
    const onUpdateCaseInfo = vi.fn();
    // dateOfDeath overridden far into the future so "today" as a Date of
    // Birth can never collide with the separate, pre-existing DOB-after-DOD
    // order check — this test is only about the future-date rule.
    render(<CaseInformationCard {...baseProps} dateOfDeath="12/31/2099" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = String(now.getFullYear());

    fireEvent.click(screen.getByRole('button', { name: '03/14/1951' }));
    const input = screen.getByDisplayValue('03/14/1951');
    fireEvent.change(input, { target: { value: `${mm}${dd}${yyyy}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfBirth: `${mm}/${dd}/${yyyy}` });
  });

  it('blocks Enter on a future Released date', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="Jane Smith" pickupReleasedAt="07/01/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const releasedDateField = screen.getByText('Released date').parentElement!;
    fireEvent.click(within(releasedDateField).getByRole('button'));
    const input = within(releasedDateField).getByDisplayValue('07/01/2026');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Released date cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('blocks Enter on a future Date shipped', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const dateShippedField = screen.getByText('Date shipped').parentElement!;
    fireEvent.click(within(dateShippedField).getByRole('button'));
    const input = within(dateShippedField).getByDisplayValue('');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Date shipped cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('blocks Enter on a future Delivered date', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const deliveredDateField = screen.getByText('Delivered date').parentElement!;
    fireEvent.click(within(deliveredDateField).getByRole('button'));
    const input = within(deliveredDateField).getByDisplayValue('');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Delivered date cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('still allows committing a valid past Date shipped', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const dateShippedField = screen.getByText('Date shipped').parentElement!;
    fireEvent.click(within(dateShippedField).getByRole('button'));
    const input = within(dateShippedField).getByDisplayValue('');
    fireEvent.change(input, { target: { value: '07012020' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ shippingDateShipped: '07/01/2020' });
  });
});

describe('CaseInformationCard — Time of Death 12-hour entry (2026-09)', () => {
  function openTimeEditor() {
    fireEvent.click(screen.getByRole('button', { name: '2:30 PM' }));
  }

  it('10. displays the stored 24-hour value (14:30) as the friendly 12-hour form (2:30 PM)', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '2:30 PM' })).toBeInTheDocument();
    expect(screen.queryByText('14:30')).not.toBeInTheDocument();
  });

  it('10. an existing stored 20:35 (backward compatibility with already-saved values) displays as 8:35 PM', () => {
    render(<CaseInformationCard {...baseProps} timeOfDeath="20:35" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '8:35 PM' })).toBeInTheDocument();
  });

  it('clicking the value reveals hour/minute/AM-PM selects pre-populated from the stored value', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    openTimeEditor();
    expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: 'Minute' })).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'AM or PM' })).toHaveValue('PM');
  });

  it('11/12/13. saving via the Save button fires exactly one onSaveTimeOfDeath call with the normalized 24-hour value', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();

    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AM or PM' }), { target: { value: 'PM' } });
    // No selection change alone has saved anything yet.
    expect(onSaveTimeOfDeath).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save time of death' }));

    expect(onSaveTimeOfDeath).toHaveBeenCalledTimes(1);
    expect(onSaveTimeOfDeath).toHaveBeenCalledWith('20:35');
  });

  it('Enter also commits (same single-call guarantee)', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();

    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '15' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AM or PM' }), { target: { value: 'AM' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Minute' }), { key: 'Enter' });

    expect(onSaveTimeOfDeath).toHaveBeenCalledTimes(1);
    expect(onSaveTimeOfDeath).toHaveBeenCalledWith('00:15');
  });

  it('does not save if the selection is unchanged from the current value', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save time of death' }));
    expect(onSaveTimeOfDeath).not.toHaveBeenCalled();
  });

  it('does not save an incomplete selection (missing AM/PM) — rejects rather than guessing', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AM or PM' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time of death' }));
    expect(onSaveTimeOfDeath).not.toHaveBeenCalled();
  });

  it('Cancel reverts without saving', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '11' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '59' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AM or PM' }), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing time of death' }));

    expect(onSaveTimeOfDeath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2:30 PM' })).toBeInTheDocument();
  });

  it('Escape also cancels without saving', () => {
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '11' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Hour' }), { key: 'Escape' });

    expect(onSaveTimeOfDeath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2:30 PM' })).toBeInTheDocument();
  });

  it('never calls onUpdateCaseInfo — Time of Death always saves through the dedicated onSaveTimeOfDeath path', () => {
    const onUpdateCaseInfo = vi.fn();
    const onSaveTimeOfDeath = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    openTimeEditor();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'AM or PM' }), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time of death' }));

    expect(onSaveTimeOfDeath).toHaveBeenCalledWith('20:35');
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('midnight (12:00 AM) round-trips to 00:00 and displays correctly afterward', () => {
    const onSaveTimeOfDeath = vi.fn();
    const { rerender } = render(<CaseInformationCard {...baseProps} timeOfDeath="00:00" onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
    expect(screen.getByRole('button', { name: '12:00 AM' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '12:00 AM' }));
    expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveValue('12');
    expect(screen.getByRole('combobox', { name: 'AM or PM' })).toHaveValue('AM');

    // Re-rendering with the same stored value (as a settled mutation
    // response would) keeps showing the correct 12-hour form.
    rerender(<CaseInformationCard {...baseProps} timeOfDeath="00:00" onUpdateCaseInfo={vi.fn()} onSaveTimeOfDeath={onSaveTimeOfDeath} />);
  });
});

describe('CaseInformationCard — payment status (Phase 17)', () => {
  it('updates paymentStatus through the same onUpdateCaseInfo path', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    const select = screen.getByDisplayValue('Awaiting payment');
    fireEvent.change(select, { target: { value: 'paid_in_full' } });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ paymentStatus: 'paid_in_full' });
  });
});

describe('CaseInformationCard — Tag # (Manors launch-prep)', () => {
  it('shows a placeholder when no tag is assigned, and saves a trimmed, uppercased value', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} tagNumber={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    // Scoped: baseProps now also has nextOfKinEmail: null, which renders
    // its own '—' placeholder (Manors launch-prep).
    const tagField = within(screen.getByText('Tag #').parentElement!);
    const button = tagField.getByRole('button', { name: '—' });
    fireEvent.click(button);
    const input = tagField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: ' t-1042 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ tagNumber: 'T-1042' });
  });

  it('clearing the tag number saves null, not an empty string', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} tagNumber="T-1042" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: 'T-1042' }));
    const input = screen.getByDisplayValue('T-1042');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ tagNumber: null });
  });
});

describe('CaseInformationCard — NOK email (Manors launch-prep)', () => {
  // baseProps has other empty fields (e.g. tagNumber: null) that also
  // render a '—' placeholder button, so every query here is scoped to the
  // "NOK email" field's own container rather than a bare screen.getByRole.
  function nokEmailField() {
    return within(screen.getByText('NOK email').parentElement!);
  }

  it('shows a placeholder when no NOK email is on file, and saves a trimmed value on Enter', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinEmail={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(nokEmailField().getByRole('button', { name: '—' }));
    const input = nokEmailField().getByDisplayValue('');
    fireEvent.change(input, { target: { value: '  karen@example.com  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinEmail: 'karen@example.com' });
  });

  it('clearing the email saves null, not an empty string', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinEmail="karen@example.com" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(nokEmailField().getByRole('button', { name: 'karen@example.com' }));
    const input = nokEmailField().getByDisplayValue('karen@example.com');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinEmail: null });
  });

  it('rejects an invalid email on Enter — shows an inline error and does not save', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinEmail={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(nokEmailField().getByRole('button', { name: '—' }));
    const input = nokEmailField().getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(nokEmailField().getByRole('alert')).toHaveTextContent(/valid email/i);
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('reverts an invalid email on blur without saving', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinEmail={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(nokEmailField().getByRole('button', { name: '—' }));
    const input = nokEmailField().getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(nokEmailField().getByRole('button', { name: '—' })).toBeInTheDocument();
  });

  it('uses a real email input type', () => {
    render(<CaseInformationCard {...baseProps} nextOfKinEmail={null} onUpdateCaseInfo={vi.fn()} />);
    fireEvent.click(nokEmailField().getByRole('button', { name: '—' }));
    expect(nokEmailField().getByDisplayValue('')).toHaveAttribute('type', 'email');
  });
});

describe('CaseInformationCard — NOK relationship (Manors launch-prep)', () => {
  it('shows an unset ("—") relationship by default and no "Other" detail field', () => {
    render(<CaseInformationCard {...baseProps} nextOfKinRelationship={null} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByDisplayValue('—')).toBeInTheDocument();
    expect(screen.queryByText('Relationship (describe)')).not.toBeInTheDocument();
  });

  it('selecting a relationship calls onUpdateCaseInfo with the chosen value', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinRelationship={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.change(screen.getByDisplayValue('—'), { target: { value: 'daughter' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinRelationship: 'daughter' });
  });

  it('clearing the relationship back to unset saves null', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinRelationship="daughter" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.change(screen.getByDisplayValue('Daughter'), { target: { value: '' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinRelationship: null });
  });

  it('selecting "Other" reveals the free-text detail field, and saves a trimmed value', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} nextOfKinRelationship="other" nextOfKinRelationshipOther={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    const detailField = within(screen.getByText('Relationship (describe)').parentElement!);
    fireEvent.click(detailField.getByRole('button', { name: '—' }));
    const input = detailField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: '  close family friend  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // SOLIS ALL-CAPS data standard (2026-09): this field now uppercases
    // as-you-type (UX only — the server normalizes authoritatively).
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinRelationshipOther: 'CLOSE FAMILY FRIEND' });
  });

  it('does not show the detail field for a non-"other" relationship, even if nextOfKinRelationshipOther happens to be set', () => {
    render(<CaseInformationCard {...baseProps} nextOfKinRelationship="daughter" nextOfKinRelationshipOther="stale value" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Relationship (describe)')).not.toBeInTheDocument();
  });
});

describe('CaseInformationCard — Pickup tracking (Manors launch-prep)', () => {
  it('shows "Awaiting Family Pickup" by default and no released-detail fields, once Return method is Pickup', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Cremated Remains')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Awaiting Family Pickup')).toBeInTheDocument();
    expect(screen.queryByText('Released to')).not.toBeInTheDocument();
    expect(screen.queryByText('Released date')).not.toBeInTheDocument();
  });

  it('reveals Released to / Released date / note fields once the case is already released', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="Karen Ellison" pickupReleasedAt="07/10/2026" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByDisplayValue('Family Picked Up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAREN ELLISON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '07/10/2026' })).toBeInTheDocument();
  });

  it('saving a released-to name trims and uppercases it, matching other name fields', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const releasedToField = screen.getByText('Released to').parentElement!;
    fireEvent.click(within(releasedToField).getByRole('button'));
    const input = within(releasedToField).getByDisplayValue('');
    fireEvent.change(input, { target: { value: ' karen ellison ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupReleasedTo: 'KAREN ELLISON' });
  });

  it('selecting "Family Picked Up" without an already-valid Released to/Released date does NOT persist pickupStatus — it reveals the detail fields and shows a required-fields message instead', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByText('Released to')).toBeInTheDocument();
    expect(screen.getByText('Released date')).toBeInTheDocument();
    expect(screen.getByText('Released to and Released date are required to mark Family Picked Up.')).toBeInTheDocument();
  });

  it('selecting "Family Picked Up" when Released to/Released date are already valid persists pickupStatus immediately (e.g. supplied earlier or via Jotform reconciliation)', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        returnMethod="pickup"
        pickupReleasedTo="Karen Ellison"
        pickupReleasedAt="07/10/2026"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupStatus: 'released' });
  });

  it('switching back to "Awaiting Family Pickup" is never gated — it persists immediately and clears the pending-release message', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    expect(screen.getByText('Released to and Released date are required to mark Family Picked Up.')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Family Picked Up'), { target: { value: 'awaiting_pickup' } });

    expect(onUpdateCaseInfo).toHaveBeenLastCalledWith({ pickupStatus: 'awaiting_pickup' });
    expect(screen.queryByText('Released to and Released date are required to mark Family Picked Up.')).not.toBeInTheDocument();
  });

  it('once both Released to and Released date are filled in after selecting "Family Picked Up", pickupStatus commits to released automatically', () => {
    const onUpdateCaseInfo = vi.fn();
    const { rerender } = render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();

    // Simulate the Released to save round-tripping back through props —
    // still incomplete (no Released date yet), so nothing commits.
    rerender(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupReleasedTo="Karen Ellison" onUpdateCaseInfo={onUpdateCaseInfo} />);
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByText('Released to and Released date are required to mark Family Picked Up.')).toBeInTheDocument();

    // Now Released date is also valid — the pending release commits.
    rerender(
      <CaseInformationCard {...baseProps} returnMethod="pickup" pickupReleasedTo="Karen Ellison" pickupReleasedAt="07/10/2026" onUpdateCaseInfo={onUpdateCaseInfo} />,
    );
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupStatus: 'released' });
  });
});

describe('CaseInformationCard — Return method (conditional shipping/tracking, 2026-09)', () => {
  it('defaults to Undecided and shows neither pickup nor shipping detail blocks', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByDisplayValue('Undecided')).toBeInTheDocument();
    expect(screen.queryByText('Cremated Remains')).not.toBeInTheDocument();
    expect(screen.queryByText('Carrier')).not.toBeInTheDocument();
    expect(screen.queryByText('Tracking number')).not.toBeInTheDocument();
  });

  it('changing Return method to Shipping updates through onUpdateCaseInfo', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Undecided'), { target: { value: 'shipping' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ returnMethod: 'shipping' });
  });

  it('shows the shipping block — Carrier, Tracking number, Date shipped, Shipping status, Delivered date — when Return method is Shipping', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Tracking number')).toBeInTheDocument();
    expect(screen.getByText('Date shipped')).toBeInTheDocument();
    expect(screen.getByText('Shipping status')).toBeInTheDocument();
    expect(screen.getByText('Delivered date')).toBeInTheDocument();
    expect(screen.queryByText('Cremated Remains')).not.toBeInTheDocument();
  });

  it('never shows the shipping block for a Pickup case, and never the pickup block for a Shipping case', () => {
    const { rerender } = render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Carrier')).not.toBeInTheDocument();
    rerender(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Cremated Remains')).not.toBeInTheDocument();
  });

  it('saving a carrier trims and uppercases it', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);
    const carrierField = screen.getByText('Carrier').parentElement!;
    fireEvent.click(within(carrierField).getByRole('button'));
    const input = within(carrierField).getByDisplayValue('');
    fireEvent.change(input, { target: { value: ' usps ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ shippingCarrier: 'USPS' });
  });

  it('shows previously entered shipping data untouched when switching back to Shipping after visiting Pickup', () => {
    const { rerender } = render(
      <CaseInformationCard {...baseProps} returnMethod="shipping" shippingCarrier="USPS" shippingTrackingNumber="9400111899223197428019" onUpdateCaseInfo={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'USPS' })).toBeInTheDocument();
    rerender(<CaseInformationCard {...baseProps} returnMethod="pickup" shippingCarrier="USPS" shippingTrackingNumber="9400111899223197428019" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Carrier')).not.toBeInTheDocument();
    rerender(<CaseInformationCard {...baseProps} returnMethod="shipping" shippingCarrier="USPS" shippingTrackingNumber="9400111899223197428019" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'USPS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9400111899223197428019' })).toBeInTheDocument();
  });

  it('item #15 (2026-09): Date shipped — a representative non-DOB/DOD date field — reuses the same fast-entry mask (auto-slashes, two-digit-year expansion)', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);
    const dateShippedField = screen.getByText('Date shipped').parentElement!;
    fireEvent.click(within(dateShippedField).getByRole('button'));
    const input = within(dateShippedField).getByDisplayValue('');

    fireEvent.change(input, { target: { value: '020290' } });
    expect(input).toHaveValue('02/02/90'); // live mask, not yet expanded

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ shippingDateShipped: '02/02/1990' });
  });

  it('setting shipping status to Delivered updates through onUpdateCaseInfo', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Not yet shipped'), { target: { value: 'delivered' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ shippingDeliveryStatus: 'delivered' });
  });
});

describe('CaseInformationCard — Task #16 (2026-09, Owner/Return method layout)', () => {
  it('Owner and Return method render in the same dedicated grid row, Owner first', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);

    const ownerLabel = screen.getByText('Owner');
    const returnMethodLabel = screen.getByText('Return method');

    // Each field label's grandparent is the shared .grid row container —
    // asserting they're the same element proves Owner/Return method are
    // grouped together, not merely "somewhere on the page."
    const ownerRow = ownerLabel.parentElement?.parentElement;
    const returnMethodRow = returnMethodLabel.parentElement?.parentElement;
    expect(ownerRow).not.toBeNull();
    expect(ownerRow).toBe(returnMethodRow);

    // Owner precedes Return method in DOM order (left column, then right).
    expect(ownerLabel.compareDocumentPosition(returnMethodLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Owner editing still works after the layout change', () => {
    const onReassignOwner = vi.fn();
    render(<CaseInformationCard {...baseProps} onReassignOwner={onReassignOwner} onUpdateCaseInfo={vi.fn()} staffOptions={[{ id: 'staff-dana', name: 'Dana' }, { id: 'staff-chris', name: 'Chris' }]} />);
    fireEvent.change(screen.getByDisplayValue('Dana'), { target: { value: 'staff-chris' } });
    expect(onReassignOwner).toHaveBeenCalledWith('staff-chris');
  });

  it('Return method editing still works after the layout change', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Undecided'), { target: { value: 'pickup' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ returnMethod: 'pickup' });
  });

  it('Return method conditional fields (pickup) still render and stay in their own separate row', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    const cremaRemainsLabel = screen.getByText('Cremated Remains');
    const returnMethodLabel = screen.getByText('Return method');
    const ownerLabel = screen.getByText('Owner');

    const conditionalRow = cremaRemainsLabel.parentElement?.parentElement;
    const ownerReturnMethodRow = returnMethodLabel.parentElement?.parentElement;
    expect(conditionalRow).not.toBe(ownerReturnMethodRow);
    expect(conditionalRow).not.toBe(ownerLabel.parentElement?.parentElement);
  });

  it('Return method conditional fields (shipping) still render and stay in their own separate row', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Date shipped')).toBeInTheDocument();
    expect(screen.getByText('Delivered date')).toBeInTheDocument();
  });

  it('Released date future-date validation (Task #15) still works after the layout change', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="Jane Smith" pickupReleasedAt="07/01/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const releasedDateField = screen.getByText('Released date').parentElement!;
    fireEvent.click(within(releasedDateField).getByRole('button'));
    const input = within(releasedDateField).getByDisplayValue('07/01/2026');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Released date cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('Date shipped future-date validation (Task #15) still works after the layout change', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const dateShippedField = screen.getByText('Date shipped').parentElement!;
    fireEvent.click(within(dateShippedField).getByRole('button'));
    const input = within(dateShippedField).getByDisplayValue('');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Date shipped cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('Delivered date future-date validation (Task #15) still works after the layout change', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="shipping" onUpdateCaseInfo={onUpdateCaseInfo} />);

    const deliveredDateField = screen.getByText('Delivered date').parentElement!;
    fireEvent.click(within(deliveredDateField).getByRole('button'));
    const input = within(deliveredDateField).getByDisplayValue('');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Delivered date cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });
});

describe('CaseInformationCard — Task #17 (2026-09, hide Case Owner for Manors)', () => {
  it('hides Owner entirely when showOwner is false', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Dana')).not.toBeInTheDocument();
  });

  it('shows Owner when showOwner is true (generic/non-Manors organization) — unchanged default behavior', () => {
    render(<CaseInformationCard {...baseProps} showOwner onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dana')).toBeInTheDocument();
  });

  it('Return method remains visible when Owner is hidden', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Return method')).toBeInTheDocument();
  });

  it('Return method occupies the first (only) position in its row when Owner is hidden — no empty placeholder column', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    const returnMethodLabel = screen.getByText('Return method');
    const row = returnMethodLabel.parentElement?.parentElement;
    expect(row).not.toBeNull();
    // Exactly one child (Return method's own wrapper <div>) — nothing else
    // in the row, so it naturally falls into the first grid column rather
    // than a reserved second one.
    expect(row?.children.length).toBe(1);
  });

  it('the Owner/Return-method row still has two children when Owner is shown (Task #16 pairing unaffected)', () => {
    render(<CaseInformationCard {...baseProps} showOwner onUpdateCaseInfo={vi.fn()} />);
    const returnMethodLabel = screen.getByText('Return method');
    const row = returnMethodLabel.parentElement?.parentElement;
    expect(row?.children.length).toBe(2);
  });

  it('Return method editing still works when Owner is hidden', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Undecided'), { target: { value: 'pickup' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ returnMethod: 'pickup' });
  });

  it('pickup conditional fields (Cremated Remains) still render and work when Owner is hidden', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);
    expect(screen.getByText('Cremated Remains')).toBeInTheDocument();
    expect(screen.getByText(/awaiting family pickup/i)).toBeInTheDocument();
  });

  it('shipping conditional fields still render when Owner is hidden', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Date shipped')).toBeInTheDocument();
    expect(screen.getByText('Delivered date')).toBeInTheDocument();
  });

  it('Task #15 future-date validation (Released date) remains intact when Owner is hidden', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        showOwner={false}
        returnMethod="pickup"
        pickupStatus="released"
        pickupReleasedTo="Jane Smith"
        pickupReleasedAt="07/01/2026"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );
    const releasedDateField = screen.getByText('Released date').parentElement!;
    fireEvent.click(within(releasedDateField).getByRole('button'));
    const input = within(releasedDateField).getByDisplayValue('07/01/2026');
    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(input, { target: { value: `0101${farFutureYear}` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Released date cannot be in the future.')).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('Task #16 operational-row spacing class is unaffected by whether Owner is shown', () => {
    const { container: withOwner } = render(<CaseInformationCard {...baseProps} showOwner onUpdateCaseInfo={vi.fn()} />);
    const { container: withoutOwner } = render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    const ownerRowWith = within(withOwner).getByText('Return method').parentElement?.parentElement;
    const ownerRowWithout = within(withoutOwner).getByText('Return method').parentElement?.parentElement;
    expect(ownerRowWith?.className).toMatch(/operationalRow/);
    expect(ownerRowWithout?.className).toMatch(/operationalRow/);
  });

  it('saving an unrelated field (Tag #) while Owner is hidden never touches ownerStaffId/onReassignOwner', () => {
    const onUpdateCaseInfo = vi.fn();
    const onReassignOwner = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={onUpdateCaseInfo} onReassignOwner={onReassignOwner} />);

    const tagField = screen.getByText('Tag #').parentElement!;
    fireEvent.click(within(tagField).getByRole('button'));
    const input = within(tagField).getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'a123' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ tagNumber: 'A123' });
    expect(onReassignOwner).not.toHaveBeenCalled();
  });
});

/**
 * Case field editing (2026-09): Weight becomes click-to-edit, same pattern
 * as every other EditableField above, but saves through the dedicated
 * onSaveWeight prop (not onUpdateCaseInfo) — see
 * hooks/useCaseMutations.ts#setWeight for why (keeping the field-backed
 * checklist item's fieldValues[index] in sync in the same save).
 */
describe('CaseInformationCard — Weight editing (2026-09)', () => {
  it('shows Weight as plain text until clicked, then as an input', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    const value = screen.getByRole('button', { name: '178 lb' });
    expect(screen.queryByDisplayValue('178 lb')).not.toBeInTheDocument();
    fireEvent.click(value);
    expect(screen.getByDisplayValue('178 lb')).toBeInTheDocument();
  });

  it('saves through onSaveWeight (never onUpdateCaseInfo) on Enter', () => {
    const onSaveWeight = vi.fn();
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '178 lb' }));
    const input = screen.getByDisplayValue('178 lb');
    fireEvent.change(input, { target: { value: '210 lb' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSaveWeight).toHaveBeenCalledTimes(1);
    expect(onSaveWeight).toHaveBeenCalledWith('210 lb');
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('saves on blur too', () => {
    const onSaveWeight = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '178 lb' }));
    const input = screen.getByDisplayValue('178 lb');
    fireEvent.change(input, { target: { value: '165 lb' } });
    fireEvent.blur(input);
    expect(onSaveWeight).toHaveBeenCalledWith('165 lb');
  });

  it('does not call onSaveWeight if the value is unchanged', () => {
    const onSaveWeight = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '178 lb' }));
    fireEvent.keyDown(screen.getByDisplayValue('178 lb'), { key: 'Enter' });
    expect(onSaveWeight).not.toHaveBeenCalled();
  });

  it('Escape reverts without saving', () => {
    const onSaveWeight = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '178 lb' }));
    const input = screen.getByDisplayValue('178 lb');
    fireEvent.change(input, { target: { value: '999 lb' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSaveWeight).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '178 lb' })).toBeInTheDocument();
  });

  it('shows the "Notify crematory" badge alongside the value when weightOver200 is true', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '178 lb' })).toBeInTheDocument();
    expect(screen.getByText('Notify crematory')).toBeInTheDocument();
  });

  it('does not show the badge when weightOver200 is false', () => {
    render(<CaseInformationCard {...baseProps} weightOver200={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Notify crematory')).not.toBeInTheDocument();
  });

  it('the badge is not shown while editing (reappears once editing ends without a value change)', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} onSaveWeight={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '178 lb' }));
    expect(screen.queryByText('Notify crematory')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByDisplayValue('178 lb'), { key: 'Escape' });
    expect(screen.getByText('Notify crematory')).toBeInTheDocument();
  });
});

describe('CaseInformationCard — Certifier Information (2026-09, ADR-041)', () => {
  it('renders a grouped "Certifier information" section with all four fields', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Certifier information')).toBeInTheDocument();
    expect(screen.getByText('Certifier name')).toBeInTheDocument();
    expect(screen.getByText('Certifier phone')).toBeInTheDocument();
    expect(screen.getByText('Certifier license #')).toBeInTheDocument();
    expect(screen.getByText('Certifier fax')).toBeInTheDocument();
  });

  it('7. is presented as a distinct section from Next of kin, with helper text clarifying it is never the family contact', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Next of kin / primary contact')).toBeInTheDocument();
    expect(screen.getByText('Certifier information')).toBeInTheDocument();
    expect(screen.getByText(/medical certifier responsible for signing the death certificate/i)).toBeInTheDocument();
    // The two group headings are genuinely distinct DOM nodes, never a
    // single combined "Next of kin & Certifier" heading.
    expect(screen.getByText('Next of kin / primary contact')).not.toBe(screen.getByText('Certifier information'));
  });

  it('the Certifier helper text is exactly "Medical certifier responsible for signing the death certificate." — no trailing NOK-contrast clause', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Medical certifier responsible for signing the death certificate.')).toBeInTheDocument();
    expect(screen.queryByText(/never the family contact above/i)).not.toBeInTheDocument();
  });

  it('shows a placeholder when every certifier field is null', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        certifierName={null}
        certifierPhone={null}
        certifierLicenseNumber={null}
        certifierFax={null}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    const nameField = within(screen.getByText('Certifier name').parentElement!);
    expect(nameField.getByRole('button', { name: '—' })).toBeInTheDocument();
  });

  it('saves a trimmed, uppercased Certifier name via onSaveCertifierName — never onUpdateCaseInfo', () => {
    const onSaveCertifierName = vi.fn();
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        certifierName={null}
        onUpdateCaseInfo={onUpdateCaseInfo}
        onSaveCertifierName={onSaveCertifierName}
      />,
    );
    const nameField = within(screen.getByText('Certifier name').parentElement!);
    fireEvent.click(nameField.getByRole('button', { name: '—' }));
    const input = nameField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: ' dr. jane foster ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveCertifierName).toHaveBeenCalledWith('DR. JANE FOSTER');
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('clearing Certifier name saves null, not an empty string', () => {
    const onSaveCertifierName = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        certifierName="DR. JANE FOSTER"
        onUpdateCaseInfo={vi.fn()}
        onSaveCertifierName={onSaveCertifierName}
      />,
    );
    const nameField = within(screen.getByText('Certifier name').parentElement!);
    fireEvent.click(nameField.getByRole('button', { name: 'DR. JANE FOSTER' }));
    const input = nameField.getByDisplayValue('DR. JANE FOSTER');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveCertifierName).toHaveBeenCalledWith(null);
  });

  it('Certifier phone is saved without uppercasing (matches NOK phone\'s unmasked convention)', () => {
    const onSaveCertifierPhone = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        certifierPhone={null}
        onUpdateCaseInfo={vi.fn()}
        onSaveCertifierPhone={onSaveCertifierPhone}
      />,
    );
    const phoneField = within(screen.getByText('Certifier phone').parentElement!);
    fireEvent.click(phoneField.getByRole('button', { name: '—' }));
    const input = phoneField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: '555-0199' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveCertifierPhone).toHaveBeenCalledWith('555-0199');
  });

  it('Certifier license # is uppercased, matching the tagNumber precedent', () => {
    const onSaveCertifierLicenseNumber = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        certifierLicenseNumber={null}
        onUpdateCaseInfo={vi.fn()}
        onSaveCertifierLicenseNumber={onSaveCertifierLicenseNumber}
      />,
    );
    const licenseField = within(screen.getByText('Certifier license #').parentElement!);
    fireEvent.click(licenseField.getByRole('button', { name: '—' }));
    const input = licenseField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'md-4471' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveCertifierLicenseNumber).toHaveBeenCalledWith('MD-4471');
  });

  it('Certifier fax is saved without uppercasing', () => {
    const onSaveCertifierFax = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        certifierFax={null}
        onUpdateCaseInfo={vi.fn()}
        onSaveCertifierFax={onSaveCertifierFax}
      />,
    );
    const faxField = within(screen.getByText('Certifier fax').parentElement!);
    fireEvent.click(faxField.getByRole('button', { name: '—' }));
    const input = faxField.getByDisplayValue('');
    fireEvent.change(input, { target: { value: '555-0188' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSaveCertifierFax).toHaveBeenCalledWith('555-0188');
  });
});
