import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CaseInformationCard } from './CaseInformationCard';
import type { CasePaymentSummary } from '@/domain/cases/casePaymentSummary';

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

/**
 * Task #5 FINAL fix (2026-09). A production case's Case.nextOfKinName can
 * be corrupted to the legacy combined "NAME — PHONE" form (see
 * domain/cases/nextOfKinName.ts for the full "why" and the shared
 * normalization helper both this component and ChecklistCard's structured
 * Family Contact editor rely on). General Info must display/edit only the
 * clean name, never the raw corrupted string, while never inventing a
 * strip that could corrupt a legitimate name containing its own
 * punctuation.
 */
describe('CaseInformationCard — Next of kin corrupted-name normalization (Task #5 FINAL fix, 2026-09)', () => {
  it('renders only the clean name when nextOfKinName is corrupted with a trailing "— phone" matching the separately stored nextOfKinPhone', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="EMMA MORALES SILVA — (954) 901-4165"
        nextOfKinPhone="(954) 901-4165"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'EMMA MORALES SILVA' })).toBeInTheDocument();
    expect(screen.queryByText('EMMA MORALES SILVA — (954) 901-4165')).not.toBeInTheDocument();
  });

  it('NOK phone still displays the phone separately, unaffected by the name normalization', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="EMMA MORALES SILVA — (954) 901-4165"
        nextOfKinPhone="(954) 901-4165"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '(954) 901-4165' })).toBeInTheDocument();
  });

  it('clean names (no separator) are rendered unchanged', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'KAREN ELLISON' })).toBeInTheDocument();
  });

  it('a name containing an em dash that does NOT correspond to the stored phone is left unchanged (no unsafe stripping)', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="SMITH — JONES FAMILY TRUST"
        nextOfKinPhone="555-0100"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'SMITH — JONES FAMILY TRUST' })).toBeInTheDocument();
  });

  it('phone-formatting-equivalent suffixes are safely recognized (dashed phone vs. parenthesized stored phone)', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="EMMA MORALES SILVA — 954-901-4165"
        nextOfKinPhone="(954) 901-4165"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'EMMA MORALES SILVA' })).toBeInTheDocument();
  });

  it('a blank/missing nextOfKinPhone never causes stripping, even if the name contains an em dash', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="EMMA MORALES SILVA — (954) 901-4165"
        nextOfKinPhone=""
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'EMMA MORALES SILVA — (954) 901-4165' })).toBeInTheDocument();
  });

  it('editing the normalized displayed name writes only the clean value to nextOfKinName, never reconstructing "NAME — PHONE"', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        nextOfKinName="EMMA MORALES SILVA — (954) 901-4165"
        nextOfKinPhone="(954) 901-4165"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'EMMA MORALES SILVA' }));
    const input = screen.getByDisplayValue('EMMA MORALES SILVA');
    fireEvent.change(input, { target: { value: 'EMMA SILVA' } });
    fireEvent.blur(input);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ nextOfKinName: 'EMMA SILVA' });
  });
});

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

describe('CaseInformationCard — payment records beside the stored Payment value (2026-10)', () => {
  const summary = (over: Partial<CasePaymentSummary>): CasePaymentSummary => ({
    state: 'awaiting_payment',
    label: 'Awaiting payment',
    detail: '$890.00 due',
    tone: 'neutral',
    totalCents: 89000,
    paidCents: 0,
    balanceDueCents: 89000,
    pendingCents: 0,
    refundedCents: 0,
    mismatch: null,
    ...over,
  });

  it('no summary (no Case Order, or no permission): the Payment field renders exactly as before', () => {
    const { container } = render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(container.querySelector('[data-payment-state]')).toBeNull();
    expect(screen.getByDisplayValue('Awaiting payment')).toBeInTheDocument();
  });

  it('partially paid: the amounts and "Partially paid" show under the select', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        paymentSummary={summary({ state: 'partial_payment', label: 'Partially paid', detail: '$445.00 of $890.00 paid · $445.00 due', tone: 'warning' })}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByText('Partially paid ·')).toBeInTheDocument();
    expect(screen.getByText(/\$445\.00 of \$890\.00 paid · \$445\.00 due/)).toBeInTheDocument();
  });

  it('paid in full and marked paid: only the amount — the select already says it', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        paymentStatus="paid_in_full"
        paymentSummary={summary({ state: 'paid_in_full', label: 'Paid in full', detail: '$890.00 paid', tone: 'success' })}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Paid in full')).toBeInTheDocument();
    expect(screen.getByText('$890.00 paid')).toBeInTheDocument();
    expect(screen.queryByText(/still show a balance/)).not.toBeInTheDocument();
  });

  it('marked paid but refunded: says so instead of agreeing with the stored value', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        paymentStatus="paid_in_full"
        paymentSummary={summary({ detail: '$890.00 due · $890.00 refunded', mismatch: 'marked_paid_with_balance' })}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByText('Marked paid, but the payment records still show a balance due.')).toBeInTheDocument();
  });

  it('the summary never writes: the stored value changes only through the select', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} paymentSummary={summary({ mismatch: null })} onUpdateCaseInfo={onUpdateCaseInfo} />);
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });
});

describe('CaseInformationCard — Tag Number (Manors launch-prep; moved to the top, 2026-10)', () => {
  it('a missing tag reads "Tag Number Missing — Add Tag Number"; that prompt starts editing and saves a trimmed, uppercased value', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} tagNumber={null} onUpdateCaseInfo={onUpdateCaseInfo} />);

    const tagField = within(screen.getByText('Tag Number').parentElement!);
    const button = tagField.getByRole('button', { name: 'Tag Number Missing — Add Tag Number' });
    expect(button.className).toMatch(/missingValue/);
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

  it('an existing tag shows its saved value prominently, with its label — not the missing prompt', () => {
    render(<CaseInformationCard {...baseProps} tagNumber="T-1042" onUpdateCaseInfo={vi.fn()} />);
    const value = screen.getByRole('button', { name: 'T-1042' });
    expect(value.className).toMatch(/tagNumberValue/);
    expect(screen.getByText('Tag Number')).toBeInTheDocument();
    expect(screen.queryByText(/Tag Number Missing/)).not.toBeInTheDocument();
  });

  it('sits with the identifying details — Name, Date of birth, Date of death, Time of death — in the first grid', () => {
    render(<CaseInformationCard {...baseProps} tagNumber="T-1042" onUpdateCaseInfo={vi.fn()} />);
    const firstGrid = screen.getByText('Name').closest('div[class*="grid"]')!;
    const labels = Array.from(firstGrid.children).map((child) => child.querySelector('div')?.textContent ?? '');
    expect(labels.slice(0, 5)).toEqual(['Name', 'Date of birth', 'Date of death', 'Time of death', 'Tag Number']);
  });

  it('there is exactly one Tag Number field in the card, and the old "Tag #" field is gone', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getAllByText('Tag Number')).toHaveLength(1);
    expect(screen.queryByText('Tag #')).not.toBeInTheDocument();
  });

  it('archived: read-only — a missing tag is stated, with no way to add one; a saved tag is plain text', () => {
    const onUpdateCaseInfo = vi.fn();
    const { unmount } = render(<CaseInformationCard {...baseProps} isArchived tagNumber={null} onUpdateCaseInfo={onUpdateCaseInfo} />);
    const tagField = within(screen.getByText('Tag Number').parentElement!);
    expect(tagField.getByText('Tag Number Missing')).toBeInTheDocument();
    expect(tagField.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    render(<CaseInformationCard {...baseProps} isArchived tagNumber="T-1042" onUpdateCaseInfo={onUpdateCaseInfo} />);
    const archived = within(screen.getByText('Tag Number').parentElement!);
    expect(archived.getByText('T-1042')).toBeInTheDocument();
    expect(archived.queryByRole('button')).not.toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('Escape still cancels an edit without saving (existing editing behaviour)', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} tagNumber={null} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tag Number Missing — Add Tag Number' }));
    const input = within(screen.getByText('Tag Number').parentElement!).getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'x9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tag Number Missing — Add Tag Number' })).toBeInTheDocument();
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

describe('CaseInformationCard — recording the release (simplified, 2026-10)', () => {
  it('shows "Awaiting Family Pickup" by default, with no release record', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Cremated Remains')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Awaiting Family Pickup')).toBeInTheDocument();
    expect(screen.queryByText(/Released to/)).not.toBeInTheDocument();
  });

  it('choosing "Family Picked Up" opens the release dialog and saves nothing yet', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    expect(screen.getByRole('dialog', { name: 'Record family pickup' })).toBeInTheDocument();
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('records the release in one patch, with the date defaulting to today and the next of kin one click away', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" nextOfKinName="Karen Ellison" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    const dialog = within(screen.getByRole('dialog'));

    const now = new Date();
    const today = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    expect(dialog.getByLabelText('Released date')).toHaveValue(today);

    fireEvent.click(dialog.getByRole('button', { name: 'Next of kin: KAREN ELLISON' }));
    expect(dialog.getByLabelText('Released to')).toHaveValue('KAREN ELLISON');
    fireEvent.click(dialog.getByRole('button', { name: 'Record pickup' }));

    expect(onUpdateCaseInfo).toHaveBeenCalledTimes(1);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupStatus: 'released', pickupReleasedTo: 'KAREN ELLISON', pickupReleasedAt: today, pickupNote: null });
  });

  it('cancelling the dialog leaves the case awaiting pickup', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Awaiting Family Pickup')).toBeInTheDocument();
  });

  it('shows a recorded release, and corrects it through the same dialog, prefilled', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="KAREN ELLISON" pickupReleasedAt="07/10/2026" pickupNote="ID CHECKED" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByDisplayValue('Family Picked Up')).toBeInTheDocument();
    expect(screen.getByText(/Released to/)).toHaveTextContent('Released to KAREN ELLISON on 07/10/2026 · ID CHECKED');

    fireEvent.click(screen.getByRole('button', { name: 'Correct release' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Released to')).toHaveValue('KAREN ELLISON');
    expect(dialog.getByLabelText('Released date')).toHaveValue('07/10/2026');
  });

  it('switching back to "Awaiting Family Pickup" is never gated', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="KAREN ELLISON" pickupReleasedAt="07/10/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Family Picked Up'), { target: { value: 'awaiting_pickup' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupStatus: 'awaiting_pickup' });
  });

  it('an archived case shows the release but offers no correction', () => {
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" isArchived pickupStatus="released" pickupReleasedTo="KAREN ELLISON" pickupReleasedAt="07/10/2026" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText(/Released to/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct release' })).not.toBeInTheDocument();
  });

  it('works the same for an organization that hides Case Owner', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    expect(screen.getByRole('dialog', { name: 'Record family pickup' })).toBeInTheDocument();
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
    render(<CaseInformationCard {...baseProps} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="JANE SMITH" pickupReleasedAt="07/01/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    // 2026-10: the release is corrected in the release dialog, which applies the same rule.
    fireEvent.click(screen.getByRole('button', { name: 'Correct release' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: `01/01/${new Date().getFullYear() + 5}` } });
    expect(dialog.getByRole('alert')).toHaveTextContent('Released date cannot be in the future.');
    expect(dialog.getByRole('button', { name: 'Record pickup' })).toBeDisabled();
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

  // Tag Number moved to the identifying details (2026-10); the Manors
  // operational row is now Payment / Return method (/ Cremated Remains).
  it('Layout follow-up: Payment and Return method share one row when Owner is hidden and returnMethod is undecided — no empty placeholder column', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    const returnMethodLabel = screen.getByText('Return method');
    const row = returnMethodLabel.parentElement?.parentElement;
    const paymentRow = screen.getByText('Payment').parentElement?.parentElement;
    expect(row).not.toBeNull();
    expect(row).toBe(paymentRow); // same shared grid row
    expect(row?.children.length).toBe(2); // Payment, Return method
  });

  it('Layout follow-up: Cremated Remains joins the same row as Payment/Return method when returnMethod is pickup', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    const row = screen.getByText('Payment').parentElement?.parentElement;
    const crematedRemainsRow = screen.getByText('Cremated Remains').parentElement?.parentElement;
    expect(crematedRemainsRow).toBe(row);
    expect(row?.children.length).toBe(3); // Payment, Return method, Cremated Remains
  });

  it('Layout follow-up: fields appear in Payment -> Return method -> Cremated Remains order', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    const row = screen.getByText('Payment').parentElement!.parentElement!;
    const labels = Array.from(row.children).map((child) => child.querySelector('div')?.textContent ?? child.textContent);
    expect(labels).toEqual(['Payment', 'Return method', 'Cremated Remains']);
  });

  it('Layout follow-up: Cremated Remains does NOT join the row for Shipping (pickup-only by domain logic) — column stays absent, not invented', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    const row = screen.getByText('Payment').parentElement?.parentElement;
    expect(row?.children.length).toBe(2); // Payment, Return method only
    expect(screen.queryByText('Cremated Remains')).not.toBeInTheDocument();
  });

  it('Layout follow-up: the recorded release sits in a separate row beneath the operational row', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        showOwner={false}
        returnMethod="pickup"
        pickupStatus="released"
        pickupReleasedTo="JANE SMITH"
        pickupReleasedAt="07/01/2026"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    const operationalRow = screen.getByText('Payment').parentElement?.parentElement;
    const releaseRow = screen.getByText(/Released to/).closest(`div[class*="grid"]`);
    expect(releaseRow).not.toBeNull();
    expect(releaseRow).not.toBe(operationalRow);
  });
  it('Layout follow-up: shipping detail fields (Carrier/Tracking/Date shipped/Shipping status/Delivered date) remain in a separate row beneath the operational row', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="shipping" onUpdateCaseInfo={vi.fn()} />);
    const operationalRow = screen.getByText('Payment').parentElement?.parentElement;
    const carrierRow = screen.getByText('Carrier').parentElement?.parentElement;
    expect(carrierRow).not.toBe(operationalRow);
  });

  it('Layout follow-up: Cremated Remains editing still works when consolidated into the operational row', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        showOwner={false}
        returnMethod="pickup"
        pickupReleasedTo="JANE SMITH"
        pickupReleasedAt="07/01/2026"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Awaiting Family Pickup'), { target: { value: 'released' } });
    // Details already on the case prefill the dialog; one click records it.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record pickup' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ pickupStatus: 'released', pickupReleasedTo: 'JANE SMITH', pickupReleasedAt: '07/01/2026', pickupNote: null });
  });
  it('Layout follow-up: Payment editing still works in the Manors consolidated row', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.change(screen.getByDisplayValue('Awaiting payment'), { target: { value: 'paid_in_full' } });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ paymentStatus: 'paid_in_full' });
  });

  it('Tag Number editing still works for Manors (Owner hidden), from its new place at the top', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={onUpdateCaseInfo} />);
    const tagField = screen.getByText('Tag Number').parentElement!;
    fireEvent.click(within(tagField).getByRole('button'));
    const input = within(tagField).getByDisplayValue('');
    fireEvent.change(input, { target: { value: 'a123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ tagNumber: 'A123' });
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
    render(<CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" pickupStatus="released" pickupReleasedTo="JANE SMITH" pickupReleasedAt="07/01/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    // 2026-10: the release is corrected in the release dialog, which applies the same rule.
    fireEvent.click(screen.getByRole('button', { name: 'Correct release' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Released date'), { target: { value: `01/01/${new Date().getFullYear() + 5}` } });
    expect(dialog.getByRole('alert')).toHaveTextContent('Released date cannot be in the future.');
    expect(dialog.getByRole('button', { name: 'Record pickup' })).toBeDisabled();
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

  it('saving an unrelated field (Tag Number) while Owner is hidden never touches ownerStaffId/onReassignOwner', () => {
    const onUpdateCaseInfo = vi.fn();
    const onReassignOwner = vi.fn();
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={onUpdateCaseInfo} onReassignOwner={onReassignOwner} />);

    const tagField = screen.getByText('Tag Number').parentElement!;
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

describe('CaseInformationCard — Task #18 (2026-09, section heading cleanup)', () => {
  it('1. "Next of kin / primary contact" remains rendered', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Next of kin / primary contact')).toBeInTheDocument();
  });

  it('2. "Certifier information" remains rendered', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Certifier information')).toBeInTheDocument();
  });

  it('3. both section headings use the dedicated .sectionHeading style, not the plain .fieldLabel style individual field labels use', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    const nokHeading = screen.getByText('Next of kin / primary contact');
    const certifierHeading = screen.getByText('Certifier information');
    expect(nokHeading.className).toMatch(/sectionHeading/);
    expect(certifierHeading.className).toMatch(/sectionHeading/);
    expect(nokHeading.className).not.toMatch(/fieldLabel/);
    expect(certifierHeading.className).not.toMatch(/fieldLabel/);
    // A real field label (e.g. "NOK phone") stays on its own distinct class,
    // proving the two headings never merely reuse field-label styling.
    expect(screen.getByText('NOK phone').className).toMatch(/fieldLabel/);
  });

  it('4. both section headings are left-aligned (via .sectionHeading\'s text-align: left rule) — proven by both sharing the identical alignment class, not a per-heading inline style', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    const nokHeading = screen.getByText('Next of kin / primary contact');
    const certifierHeading = screen.getByText('Certifier information');
    const nokHeadingClass = nokHeading.className.match(/\S*sectionHeading\S*/)?.[0];
    const certifierHeadingClass = certifierHeading.className.match(/\S*sectionHeading\S*/)?.[0];
    expect(nokHeadingClass).toBeTruthy();
    expect(nokHeadingClass).toBe(certifierHeadingClass);
  });

  it('5. Certifier helper text remains present, using the dedicated left-aligned .sectionHelperText style', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    const helperText = screen.getByText('Medical certifier responsible for signing the death certificate.');
    expect(helperText).toBeInTheDocument();
    expect(helperText.className).toMatch(/sectionHelperText/);
  });

  it('6. NOK fields remain unchanged: all four still render under the (now-restyled) heading', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Next of kin')).toBeInTheDocument();
    expect(screen.getByText('NOK phone')).toBeInTheDocument();
    expect(screen.getByText('NOK email')).toBeInTheDocument();
    expect(screen.getByText('NOK relationship')).toBeInTheDocument();
  });

  it('7. Certifier fields remain unchanged: all four still render under the (now-restyled) heading', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Certifier name')).toBeInTheDocument();
    expect(screen.getByText('Certifier phone')).toBeInTheDocument();
    expect(screen.getByText('Certifier license #')).toBeInTheDocument();
    expect(screen.getByText('Certifier fax')).toBeInTheDocument();
  });

  it('8. Manors Owner remains hidden (showOwner=false) — heading restyling made no change to Task #17 visibility', () => {
    render(<CaseInformationCard {...baseProps} showOwner={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });

  it('9. the Payment/Return method/Cremated Remains consolidated row remains intact for Manors (Tag Number moved to the top, 2026-10)', () => {
    render(
      <CaseInformationCard {...baseProps} showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />,
    );
    const row = screen.getByText('Payment').parentElement!.parentElement!;
    expect(Array.from(row.children).map((child) => child.textContent)).toEqual([
      expect.stringContaining('Payment'),
      expect.stringContaining('Return method'),
      expect.stringContaining('Cremated Remains'),
    ]);
  });

  it('10. existing responsive .grid structure is untouched: section headings are separate siblings, never rendered as extra children inside a field .grid', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    const nokHeading = screen.getByText('Next of kin / primary contact');
    const nokFieldRow = screen.getByText('Next of kin').parentElement!.parentElement!;
    // The heading is not a child of the NOK fields' own grid row — it is a
    // preceding sibling, so the grid's own column/child count is unaffected.
    expect(nokFieldRow.className).toMatch(/grid/);
    expect(Array.from(nokFieldRow.children)).not.toContain(nokHeading);
    expect(nokHeading.className).not.toMatch(/grid/);
  });
});

describe('CaseInformationCard — Notify Crematory warning layout correction (2026-09)', () => {
  it('1. Weight remains a normal single-grid-track field: its wrapper carries no special width class at all', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const weightWrapper = screen.getByText('Weight').parentElement!;
    // EditableField's outer div renders with no className at all (undefined),
    // matching every one of its siblings (Date of birth, Location, etc.) —
    // there is no longer any Weight-only wrapper class to opt into.
    expect(weightWrapper.className).toBe('');
  });

  it('2. no grid-column: span 2 (or any .weightNotifyExpanded-style) class remains anywhere on Weight\'s wrapper, on or off', () => {
    const { rerender } = render(<CaseInformationCard {...baseProps} weightOver200={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Weight').parentElement!.className).not.toMatch(/weightNotifyExpanded|span/i);
    rerender(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Weight').parentElement!.className).not.toMatch(/weightNotifyExpanded|span/i);
  });

  it("3. Weight's wrapper stays inside the same DOB/DOD/Time of death/Location .grid row as every other field in that row — never moved to a separate section", () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const weightWrapper = screen.getByText('Weight').parentElement!;
    const dobWrapper = screen.getByText('Date of birth').parentElement!;
    expect(weightWrapper.parentElement).toBe(dobWrapper.parentElement);
  });

  it('4. "Notify crematory" remains rendered immediately beside the Weight value, associated with Weight (not a separate field)', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const badge = screen.getByText('Notify crematory');
    const valueRow = screen.getByRole('button', { name: /lb/ }).parentElement!;
    expect(Array.from(valueRow.children)).toContain(badge);
  });

  it('5. the badge receives the flex-allocation fix (flex-shrink: 0 + white-space: nowrap) so its text is never squeezed into wrapping — the widening/readability fix, applied to the badge itself, not the grid', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const badge = screen.getByText('Notify crematory');
    expect(badge.className).toMatch(/notifyBadge/);
    // The class hook the CSS rule (flex-shrink: 0; white-space: nowrap;
    // see CaseInformationCard.module.css .notifyBadge) targets — actual
    // computed layout isn't available in jsdom, so the fix is verified via
    // this class hook plus static CSS review, matching this file's
    // established pattern for CSS-module-driven style assertions.
  });

  it('6. the existing "Notify crematory" wording is unchanged', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Notify crematory')).toBeInTheDocument();
    expect(screen.queryByText(/notify the crematory/i)).not.toBeInTheDocument();
  });

  it('7. weightOver200 remains the sole trigger for the badge — no new trigger condition introduced', () => {
    const { rerender } = render(<CaseInformationCard {...baseProps} weightOver200={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Notify crematory')).not.toBeInTheDocument();
    rerender(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Notify crematory')).toBeInTheDocument();
  });

  it("8. Weight's click-to-edit save behavior is unaffected by the layout correction", () => {
    const onSaveWeight = vi.fn();
    render(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200 onUpdateCaseInfo={vi.fn()} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '242 lb' }));
    const input = screen.getByDisplayValue('242 lb');
    fireEvent.change(input, { target: { value: '190 lb' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSaveWeight).toHaveBeenCalledWith('190 lb');
  });

  it('9. Date of birth / Date of death / Time of death / Location remain rendered and unaffected', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Date of birth')).toBeInTheDocument();
    expect(screen.getByText('Date of death')).toBeInTheDocument();
    expect(screen.getByText('Time of death')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
  });

  it('10. the rest of Case Information (NOK/Certifier headings, operational row, Owner visibility) is unaffected by the Notify Crematory correction', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Next of kin / primary contact')).toBeInTheDocument();
    expect(screen.getByText('Certifier information')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.getByText('Tag Number')).toBeInTheDocument();
    expect(screen.getByText('Cremated Remains')).toBeInTheDocument();
  });
});

describe('CaseInformationCard — Notify Crematory badge spacing (2026-09)', () => {
  it('1. Weight remains one normal grid track (no wrapper-level width class, same as every other field in its row)', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Weight').parentElement!.className).toBe('');
  });

  it('2. Notify crematory remains rendered inside the Weight value row', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const badge = screen.getByText('Notify crematory');
    const valueRow = screen.getByRole('button', { name: /lb/ }).parentElement!;
    expect(Array.from(valueRow.children)).toContain(badge);
  });

  it('3-4. the badge remains one-line and non-shrinking (flex-shrink: 0 + white-space: nowrap, unchanged from the prior correction)', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Notify crematory').className).toMatch(/notifyBadge/);
  });

  it("5. Weight's value button uses the compact trailing-badge layout (width: auto via .editableValueCompact) only while the badge is showing", () => {
    const { rerender } = render(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '242 lb' }).className).not.toMatch(/editableValueCompact/);

    rerender(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '242 lb' }).className).toMatch(/editableValueCompact/);
  });

  it('6. no large flexible spacer remains between the Weight value and the badge: only Weight\'s own value button (the one with a trailing badge) gets the compact/shrink-to-content treatment — every other field\'s value button keeps its full-width (width: 100%) click target untouched', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    const weightButton = screen.getByRole('button', { name: /lb/ });
    const dobButton = screen.getByRole('button', { name: '03/14/1951' });
    expect(weightButton.className).toMatch(/editableValueCompact/);
    expect(dobButton.className).not.toMatch(/editableValueCompact/);
  });

  it('7. Weight remains editable with the compact layout in place', () => {
    const onSaveWeight = vi.fn();
    render(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200 onUpdateCaseInfo={vi.fn()} onSaveWeight={onSaveWeight} />);
    fireEvent.click(screen.getByRole('button', { name: '242 lb' }));
    const input = screen.getByDisplayValue('242 lb');
    fireEvent.change(input, { target: { value: '175 lb' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSaveWeight).toHaveBeenCalledWith('175 lb');
  });

  it('8. weightOver200 remains the only trigger for both the badge and the compact layout', () => {
    const { rerender } = render(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200={false} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Notify crematory')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '242 lb' }).className).not.toMatch(/editableValueCompact/);

    rerender(<CaseInformationCard {...baseProps} weight="242 lb" weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Notify crematory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '242 lb' }).className).toMatch(/editableValueCompact/);
  });

  it('9. other EditableFields (Date of birth, Date of death, Time of death, Location) remain unchanged — no trailing badge, no compact class, normal width: 100% click target', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: '03/14/1951' }).className).not.toMatch(/editableValueCompact/);
    expect(screen.getByRole('button', { name: '07/09/2026' }).className).not.toMatch(/editableValueCompact/);
    expect(screen.getByText('ST. MARY\'S HOSPITAL')).toBeInTheDocument();
  });

  it('10. no Case Information regressions: NOK/Certifier headings, consolidated operational row, and Owner visibility remain intact', () => {
    render(<CaseInformationCard {...baseProps} weightOver200 showOwner={false} returnMethod="pickup" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByText('Next of kin / primary contact')).toBeInTheDocument();
    expect(screen.getByText('Certifier information')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.getByText('Tag Number')).toBeInTheDocument();
    expect(screen.getByText('Cremated Remains')).toBeInTheDocument();
  });
});

describe('CaseInformationCard — Medical Examiner pending values (2026-10)', () => {
  it('describes blanks as Pending Medical Examiner on an ME case', () => {
    // The ME often has not released these when the Arrangement Form is
    // submitted. Display only — nothing is invented or back-filled.
    render(
      <CaseInformationCard
        {...baseProps}
        isMedicalExaminerCase
        weight=""
        timeOfDeath=""
        certifierName={null}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Pending Medical Examiner').length).toBeGreaterThanOrEqual(3);
  });

  it('never replaces a value that genuinely exists', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        isMedicalExaminerCase
        weight="117"
        timeOfDeath="13:30"
        certifierName="JOHN ZARAVINOS"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByText('117')).toBeInTheDocument();
    expect(screen.getByText('JOHN ZARAVINOS')).toBeInTheDocument();
    expect(screen.queryByText('Pending Medical Examiner')).not.toBeInTheDocument();
  });

  it('a standard case still shows an em dash', () => {
    render(<CaseInformationCard {...baseProps} weight="" certifierName={null} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Pending Medical Examiner')).not.toBeInTheDocument();
  });
});

/**
 * Archived cases are read-only (2026-10). The server refuses the write
 * regardless; this is so staff are never handed a control that fails.
 */
describe('CaseInformationCard — archived cases are read-only', () => {
  it('shows a field as plain text with no way to start editing', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived />);

    expect(screen.getByText("ST. MARY'S HOSPITAL")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "ST. MARY'S HOSPITAL" })).not.toBeInTheDocument();
  });

  it('still shows every value — an archived case is read-only, not redacted', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived />);

    expect(screen.getByText("ST. MARY'S HOSPITAL")).toBeInTheDocument();
    expect(screen.getByText(baseProps.nextOfKinName)).toBeInTheDocument();
  });

  it('disables the selects', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived />);
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeDisabled();
    }
  });

  it('says why the fields are not editable', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived />);
    expect(screen.getByText(/archived and is shown read-only/i)).toBeInTheDocument();
  });

  it('keeps Restore available — it is the authorized way out of this state', () => {
    const onArchiveChange = vi.fn();
    render(
      <CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived onArchiveChange={onArchiveChange} />,
    );

    const restore = screen.getByRole('button', { name: /restore case/i });
    expect(restore).toBeEnabled();
    fireEvent.click(restore);
    expect(onArchiveChange).toHaveBeenCalledWith(false);
  });

  it('leaves a live case fully editable', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} isArchived={false} />);

    fireEvent.click(screen.getByRole('button', { name: "ST. MARY'S HOSPITAL" }));
    const input = screen.getByDisplayValue("ST. MARY'S HOSPITAL");
    fireEvent.change(input, { target: { value: 'general hospital' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalled();
  });
});

/**
 * Decedent middle name (2026-10). Stored separately from `decedentName`,
 * which is never re-parsed, and shown as part of ONE complete name rather
 * than as a standalone field — see domain/cases/decedentName.ts.
 */
describe('CaseInformationCard — the deceased name is one complete name', () => {
  it('shows first, middle and last together', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        decedentName="JOYCE GOLLIS"
        decedentMiddleName="BEVERLY"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByText('Joyce Beverly Gollis')).toBeInTheDocument();
  });

  it('has NO separate middle-name field', () => {
    render(<CaseInformationCard {...baseProps} decedentMiddleName="BEVERLY" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Middle name')).not.toBeInTheDocument();
    // And no editable control carrying the middle name on its own.
    expect(screen.queryByRole('button', { name: 'BEVERLY' })).not.toBeInTheDocument();
  });

  it('shows the stored name unchanged when there is no middle name', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        decedentName="JOHN SMITH"
        decedentMiddleName={null}
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    // No double space, no trailing space, nothing invented.
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('never splits a multi-word surname', () => {
    render(
      <CaseInformationCard
        {...baseProps}
        decedentName="EVARISTA SILVA RIVERO"
        decedentMiddleName="ROSA"
        onUpdateCaseInfo={vi.fn()}
      />,
    );
    expect(screen.getByText('Evarista Rosa Silva Rivero')).toBeInTheDocument();
  });
});

/**
 * Edit Name (2026-10). Corrects the deceased's name from beside the name
 * itself. Two fields — the name as recorded and the middle name — never
 * first/middle/last, because splitting a stored name means guessing where
 * a multi-word surname begins.
 */
describe('CaseInformationCard — Edit Name', () => {
  function openDialog(props: Record<string, unknown> = {}) {
    const onUpdateCaseInfo = vi.fn();
    render(
      <CaseInformationCard
        {...baseProps}
        decedentName="JOYCE GOLLIS"
        decedentMiddleName="BEVERLY"
        onUpdateCaseInfo={onUpdateCaseInfo}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    return { onUpdateCaseInfo };
  }

  it('offers an Edit Name control beside the name', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Edit Name' })).toBeInTheDocument();
  });

  it('edits the name and the middle name together, with no separate panel field', () => {
    openDialog();
    expect(screen.getByDisplayValue('JOYCE GOLLIS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BEVERLY')).toBeInTheDocument();
    // The removed panel row must not come back.
    expect(screen.queryByText('Middle name:')).not.toBeInTheDocument();
  });

  it('previews exactly how the two will read together', () => {
    openDialog();
    // Scoped to the dialog — the panel shows the same name behind it.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Will display as')).toBeInTheDocument();
    expect(within(dialog).getByText('Joyce Beverly Gollis')).toBeInTheDocument();
  });

  it('saves both values in one update', () => {
    const { onUpdateCaseInfo } = openDialog();
    fireEvent.change(screen.getByDisplayValue('BEVERLY'), { target: { value: 'beverley' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ decedentName: 'JOYCE GOLLIS', decedentMiddleName: 'BEVERLEY' });
  });

  it('clearing the middle name stores null, not an empty string', () => {
    const { onUpdateCaseInfo } = openDialog();
    fireEvent.change(screen.getByDisplayValue('BEVERLY'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ decedentName: 'JOYCE GOLLIS', decedentMiddleName: null });
  });

  it('never splits a multi-word surname — the name is edited as one value', () => {
    const { onUpdateCaseInfo } = openDialog({ decedentName: 'EVARISTA SILVA RIVERO', decedentMiddleName: 'ROSA' });
    expect(screen.getByDisplayValue('EVARISTA SILVA RIVERO')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Evarista Rosa Silva Rivero')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({
      decedentName: 'EVARISTA SILVA RIVERO',
      decedentMiddleName: 'ROSA',
    });
  });

  it('edits the STORED name, never the composed one', () => {
    // The dialog writes back to `decedentName`. If it were seeded with the
    // composed name, saving would permanently bake the middle name into
    // the stored value — and the next composition would read it twice.
    const { onUpdateCaseInfo } = openDialog();
    expect(screen.getByDisplayValue('JOYCE GOLLIS')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('JOYCE BEVERLY GOLLIS')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ decedentName: 'JOYCE GOLLIS', decedentMiddleName: 'BEVERLY' });
  });

  it('cancelling changes nothing', () => {
    const { onUpdateCaseInfo } = openDialog();
    fireEvent.change(screen.getByDisplayValue('BEVERLY'), { target: { value: 'WRONG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('refuses to save an empty name', () => {
    openDialog();
    fireEvent.change(screen.getByDisplayValue('JOYCE GOLLIS'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is absent entirely on an archived case', () => {
    render(<CaseInformationCard {...baseProps} onUpdateCaseInfo={vi.fn()} isArchived />);
    expect(screen.queryByRole('button', { name: 'Edit Name' })).not.toBeInTheDocument();
  });
});

describe('CaseInformationCard — Date of Cremation (2026-10)', () => {
  const field = () => within(screen.getByText('Date of Cremation').parentElement!);

  it('sits with the key dates, right after Tag Number — Tag Number keeps its place', () => {
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="10/10/2026" onUpdateCaseInfo={vi.fn()} />);
    const firstGrid = screen.getByText('Name').closest('div[class*="grid"]')!;
    const labels = Array.from(firstGrid.children).map((child) => child.querySelector('div')?.textContent ?? '');
    expect(labels.slice(0, 6)).toEqual(['Name', 'Date of birth', 'Date of death', 'Time of death', 'Tag Number', 'Date of Cremation']);
    expect(field().getByRole('button', { name: '10/10/2026' })).toBeInTheDocument();
  });

  it('a missing date reads "Not recorded"', () => {
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation={null} onUpdateCaseInfo={vi.fn()} />);
    expect(field().getByText('Not recorded')).toBeInTheDocument();
  });

  it('staff enter it with the same date editor as Date of death, saved exactly as typed (no timezone shift)', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation={null} onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(field().getByRole('button'));
    const input = field().getByDisplayValue('');
    fireEvent.change(input, { target: { value: '07/15/2026' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfCremation: '07/15/2026' });
  });

  it('corrects an existing date', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(field().getByRole('button', { name: '07/15/2026' }));
    const input = field().getByDisplayValue('07/15/2026');
    fireEvent.change(input, { target: { value: '07/16/2026' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfCremation: '07/16/2026' });
  });

  it('refuses a future date, a date before the death, an impossible date — and never blanks a recorded one', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    for (const bad of ['12/31/2099', '07/01/2026', '02/30/2026', '']) {
      fireEvent.click(field().getByRole('button', { name: '07/15/2026' }));
      const input = field().getByDisplayValue('07/15/2026');
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.blur(input);
    }
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(field().getByRole('button', { name: '07/15/2026' })).toBeInTheDocument();
  });

  it('an emptied box is never a clear — Enter puts the recorded date back, as leaving the box does', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(field().getByRole('button', { name: '07/15/2026' }));
    const input = field().getByDisplayValue('07/15/2026');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(field().getByRole('button', { name: '07/15/2026' })).toBeInTheDocument();
  });

  it('clearing a recorded date is an explicit, confirmed action that saves null', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(field().getByRole('button', { name: 'Clear Date of Cremation' }));
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('group', { name: 'Confirm clearing Date of Cremation' }));
    expect(confirm.getByText(/Existing Certificates are kept/)).toBeInTheDocument();
    fireEvent.click(confirm.getByRole('button', { name: 'Clear date' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledTimes(1);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ dateOfCremation: null });
    expect(field().getByText('Not recorded')).toBeInTheDocument();
  });

  it('cancelling the confirmation keeps the date', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={onUpdateCaseInfo} />);
    fireEvent.click(field().getByRole('button', { name: 'Clear Date of Cremation' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm clearing Date of Cremation' })).getByRole('button', { name: 'Cancel' }));
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(field().getByRole('button', { name: '07/15/2026' })).toBeInTheDocument();
  });

  it('nothing to clear when no date is recorded', () => {
    render(<CaseInformationCard {...baseProps} showDateOfCremation dateOfCremation={null} onUpdateCaseInfo={vi.fn()} />);
    expect(field().queryByRole('button', { name: 'Clear Date of Cremation' })).not.toBeInTheDocument();
  });

  it('archived: read-only', () => {
    render(<CaseInformationCard {...baseProps} isArchived showDateOfCremation dateOfCremation="07/15/2026" onUpdateCaseInfo={vi.fn()} />);
    expect(field().getByText('07/15/2026')).toBeInTheDocument();
    expect(field().queryByRole('button')).not.toBeInTheDocument();
  });

  it('is not shown for an organization without the Certificate of Cremation', () => {
    render(<CaseInformationCard {...baseProps} dateOfCremation="07/15/2026" onUpdateCaseInfo={vi.fn()} />);
    expect(screen.queryByText('Date of Cremation')).not.toBeInTheDocument();
  });
});
