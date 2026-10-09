import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ContactInstructionsSection } from './ContactInstructionsSection';

const baseProps = {
  doNotContactNextOfKin: false,
  arrangementContactName: null,
  arrangementContactRelationship: null,
  arrangementContactPhone: null,
  arrangementContactEmail: null,
  contactInstructions: null,
  arrangementAuthorizationConfirmed: false,
  arrangementAuthorizationSource: null,
  nextOfKinName: 'KAREN ELLISON',
  onUpdateCaseInfo: () => {},
};

describe('ContactInstructionsSection', () => {
  it('shows no restriction warning on a case with nothing recorded', () => {
    render(<ContactInstructionsSection {...baseProps} />);

    expect(screen.queryByText(/Do not contact the next of kin directly/)).not.toBeInTheDocument();
    // The checkbox is present and unchecked — an absent value reads as "no
    // restriction recorded", never as a restriction.
    expect(screen.getByLabelText('Do not contact next of kin directly')).not.toBeChecked();
  });

  it('states that naming an arrangement contact grants no legal authority', () => {
    render(<ContactInstructionsSection {...baseProps} />);

    expect(
      screen.getByText(/does not give them signing, disposition, or cremation\s+authorization authority/),
    ).toBeInTheDocument();
    expect(screen.getByText(/stays the legal contact\s+of record/)).toBeInTheDocument();
  });

  it('warns and names who to call instead when the restriction is active', () => {
    render(
      <ContactInstructionsSection
        {...baseProps}
        doNotContactNextOfKin
        arrangementContactName="MICHAEL ELLISON"
        arrangementContactRelationship="SON"
      />,
    );

    expect(screen.getByText('Do not contact the next of kin directly')).toBeInTheDocument();
    expect(screen.getByText(/Route all contact through MICHAEL ELLISON \(SON\)\./)).toBeInTheDocument();
  });

  it('never implies a substitute contact exists when none has been named', () => {
    // An empty arrangement-contact field is not consent and not a fallback
    // contact — the banner has to say so rather than render "Route all
    // contact through ." and leave staff to guess.
    render(<ContactInstructionsSection {...baseProps} doNotContactNextOfKin />);

    expect(screen.getByText(/No arrangement contact has been recorded yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Route all contact through/)).not.toBeInTheDocument();
  });

  it('adding a restriction applies immediately, with no confirmation', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<ContactInstructionsSection {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByLabelText('Do not contact next of kin directly'));

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ doNotContactNextOfKin: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removing a restriction requires confirmation and saves nothing until confirmed', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <ContactInstructionsSection {...baseProps} doNotContactNextOfKin onUpdateCaseInfo={onUpdateCaseInfo} />,
    );

    fireEvent.click(screen.getByLabelText('Do not contact next of kin directly'));

    // Nothing persisted yet — this is the whole point of the requirement
    // "never silently clear the restriction."
    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Removing it means/)).toBeInTheDocument();
    // Names the actual person, so staff confirm a fact rather than an
    // abstraction.
    expect(within(dialog).getByText(/KAREN ELLISON/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove restriction' }));
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ doNotContactNextOfKin: false });
  });

  it('backing out of the confirmation leaves the restriction untouched', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <ContactInstructionsSection {...baseProps} doNotContactNextOfKin onUpdateCaseInfo={onUpdateCaseInfo} />,
    );

    fireEvent.click(screen.getByLabelText('Do not contact next of kin directly'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep restriction' }));

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByText('Do not contact the next of kin directly')).toBeInTheDocument();
    expect(screen.getByLabelText('Do not contact next of kin directly')).toBeChecked();
  });

  it('tells staff the arrangement contact and notes survive removal', () => {
    render(<ContactInstructionsSection {...baseProps} doNotContactNextOfKin />);
    fireEvent.click(screen.getByLabelText('Do not contact next of kin directly'));

    expect(
      within(screen.getByRole('dialog')).getByText(/The arrangement contact and any notes are kept/),
    ).toBeInTheDocument();
  });

  it('offers a dialable link for the arrangement contact phone', () => {
    render(<ContactInstructionsSection {...baseProps} arrangementContactPhone="(555) 886-1190" />);

    const link = screen.getByRole('link', { name: 'Call' });
    // Formatting characters stripped for the URI; the displayed value is
    // left exactly as staff typed it.
    expect(link).toHaveAttribute('href', 'tel:5558861190');
    expect(screen.getByRole('button', { name: '(555) 886-1190' })).toBeInTheDocument();
  });

  it('offers no call link when no phone is recorded', () => {
    render(<ContactInstructionsSection {...baseProps} />);
    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument();
  });

  it('dials an extension as a pause, never as extra digits on the number', () => {
    // Naive stripping would yield tel:21455501994 — a different, wrong
    // number. The comma makes the phone dial, pause, then send "4".
    render(<ContactInstructionsSection {...baseProps} arrangementContactPhone="214-555-0199 ext 4" />);
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2145550199,4');
  });

  it('preserves an international prefix', () => {
    render(<ContactInstructionsSection {...baseProps} arrangementContactPhone="+44 20 7946 0958" />);
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+442079460958');
  });

  it('saves an edited arrangement contact, uppercased, trimmed and null when cleared', () => {
    const onUpdateCaseInfo = vi.fn();
    const { rerender } = render(
      <ContactInstructionsSection {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />,
    );

    // Four fields are empty, so address the first by position — the
    // display buttons carry the value as their accessible name, matching
    // CaseInformationCard's own EditableField.
    fireEvent.click(screen.getAllByRole('button', { name: '—' })[0]);
    const input = screen.getByLabelText('Arrangement contact');
    fireEvent.change(input, { target: { value: '  michael ellison  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ arrangementContactName: 'MICHAEL ELLISON' });

    onUpdateCaseInfo.mockClear();
    rerender(
      <ContactInstructionsSection
        {...baseProps}
        arrangementContactName="MICHAEL ELLISON"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'MICHAEL ELLISON' }));
    const populated = screen.getByLabelText('Arrangement contact');
    fireEvent.change(populated, { target: { value: '' } });
    fireEvent.blur(populated);

    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ arrangementContactName: null });
  });

  it('Escape abandons an edit without saving', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <ContactInstructionsSection
        {...baseProps}
        arrangementContactRelationship="SON"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SON' }));
    const input = screen.getByLabelText('Their relationship');
    fireEvent.change(input, { target: { value: 'DAUGHTER' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'SON' })).toBeInTheDocument();
  });

  it('reverts rather than saving an invalid arrangement email', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<ContactInstructionsSection {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    const emailDisplay = screen.getAllByRole('button', { name: '—' })[3];
    fireEvent.click(emailDisplay);
    const input = screen.getByLabelText('Contact email');
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.blur(input);

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();
  });

  it('saves multiline instructions on blur, with Enter inserting a newline instead of committing', () => {
    const onUpdateCaseInfo = vi.fn();
    render(<ContactInstructionsSection {...baseProps} onUpdateCaseInfo={onUpdateCaseInfo} />);

    fireEvent.click(screen.getByRole('button', { name: /All calls to her son Michael after 6pm/ }));
    const area = screen.getByLabelText('Notes / special instructions');
    fireEvent.change(area, { target: { value: 'Line one\nLine two' } });
    fireEvent.keyDown(area, { key: 'Enter' });

    expect(onUpdateCaseInfo).not.toHaveBeenCalled();

    fireEvent.blur(area);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ contactInstructions: 'Line one\nLine two' });
  });

  it('caps the instructions field at the length the API accepts', () => {
    render(<ContactInstructionsSection {...baseProps} contactInstructions="Existing note" />);
    fireEvent.click(screen.getByRole('button', { name: 'Existing note' }));

    // Matches lib/wixCaseMapper.ts's own 2000-character cap, so the field
    // cannot produce a payload the server will reject.
    expect(screen.getByLabelText('Notes / special instructions')).toHaveAttribute('maxlength', '2000');
  });

  it('records authorization separately from naming a contact', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <ContactInstructionsSection
        {...baseProps}
        arrangementContactName="MICHAEL ELLISON"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );

    // A named contact is NOT authorization — the two must never be
    // conflated, so the box stays unchecked until someone confirms it.
    const box = screen.getByLabelText('Next of kin confirmed this arrangement contact');
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    expect(onUpdateCaseInfo).toHaveBeenCalledWith({ arrangementAuthorizationConfirmed: true });
  });

  it('hides the authorization-source field until it is relevant, but never hides recorded text', () => {
    const { rerender } = render(<ContactInstructionsSection {...baseProps} />);
    expect(screen.queryByText('How it was confirmed')).not.toBeInTheDocument();

    rerender(<ContactInstructionsSection {...baseProps} arrangementAuthorizationConfirmed />);
    expect(screen.getByText('How it was confirmed')).toBeInTheDocument();

    // Unchecking must not make an already-recorded reference invisible.
    rerender(
      <ContactInstructionsSection {...baseProps} arrangementAuthorizationSource="Spoke with Karen 10/09" />,
    );
    expect(screen.getByRole('button', { name: 'Spoke with Karen 10/09' })).toBeInTheDocument();
  });

  it('read-only mode exposes the warning but no edit affordances', () => {
    const onUpdateCaseInfo = vi.fn();
    render(
      <ContactInstructionsSection
        {...baseProps}
        readOnly
        doNotContactNextOfKin
        arrangementContactName="MICHAEL ELLISON"
        arrangementContactPhone="(555) 886-1190"
        onUpdateCaseInfo={onUpdateCaseInfo}
      />,
    );

    expect(screen.getByText('Do not contact the next of kin directly')).toBeInTheDocument();
    expect(screen.getByLabelText('Do not contact next of kin directly')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'MICHAEL ELLISON' })).not.toBeInTheDocument();
    expect(screen.getByText('MICHAEL ELLISON')).toBeInTheDocument();
    // Still dialable — read-only restricts editing, not calling.
    expect(screen.getByRole('link', { name: 'Call' })).toBeInTheDocument();
  });
});
