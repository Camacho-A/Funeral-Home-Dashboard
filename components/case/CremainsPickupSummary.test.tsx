import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CremainsPickupSummary, formatPickupDate, paperworkDateFromNotes } from './CremainsPickupSummary';
import type { Appointment } from '@/types/appointment';
import { allDayWindowFor } from '@/domain/scheduling/cremainsPickupPresentation';

function pickup(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'cremains-pickup-case-1',
    organizationId: 'managed-cremations',
    caseId: 'case-1',
    appointmentType: 'cremains.pickup.expected',
    title: 'Expected Cremains Pickup — B2026-040',
    notes: 'AUTOMATICALLY SCHEDULED FROM COMPLETED CREMATORY PAPERWORK ON 2026-10-08.',
    locationId: null,
    status: 'scheduled',
    // Far future so the derived status is never accidentally Overdue.
    // Anchored at the organization's own midnight (Eastern), which is what
    // the service stores — a UTC-midnight anchor would read as Oct 15.
    ...allDayWindowFor('2099-10-16', 'America/New_York'),
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'system',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: 'c-1',
    createdAt: '2026-10-08T18:00:00.000Z',
    updatedAt: '2026-10-08T18:00:00.000Z',
    ...overrides,
  };
}

const otherAppointment = { ...pickup({ id: 'a-2' }), appointmentType: 'viewing', title: 'Viewing' } as Appointment;

describe('CremainsPickupSummary', () => {
  it('renders nothing when the case has no expected pickup — no empty card', () => {
    const { container } = render(<CremainsPickupSummary appointments={[otherAppointment]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the expected date, Estimated status, and the paperwork date', () => {
    render(<CremainsPickupSummary appointments={[otherAppointment, pickup()]} />);
    expect(screen.getByText('Expected Cremains Pickup')).toBeInTheDocument();
    expect(screen.getByText('Friday, October 16, 2099')).toBeInTheDocument();
    expect(screen.getByText('Estimated')).toBeInTheDocument();
    expect(screen.getByText('Thursday, October 8, 2026')).toBeInTheDocument();
    expect(screen.getByText('Automatically calculated')).toBeInTheDocument();
  });

  it('never displays an invented pickup time', () => {
    const { container } = render(<CremainsPickupSummary appointments={[pickup()]} />);
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('shows Confirmed and attributes the date to staff once confirmed', () => {
    render(<CremainsPickupSummary appointments={[pickup({ status: 'confirmed' })]} />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Set by staff')).toBeInTheDocument();
  });

  it('attributes a manually re-dated pickup to staff', () => {
    render(<CremainsPickupSummary appointments={[pickup({ lastModifiedBy: 'identity-dana' })]} />);
    expect(screen.getByText('Set by staff')).toBeInTheDocument();
  });

  it('switches to Cremains Received, with no overdue warning, once received', () => {
    render(<CremainsPickupSummary appointments={[pickup({ status: 'completed', ...allDayWindowFor('2020-01-03', 'America/New_York') })]} />);
    expect(screen.getByText('Cremains Received')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.queryByText(/expected date has passed/i)).not.toBeInTheDocument();
  });

  it('derives Overdue from a past date that was never received, and says why', () => {
    render(<CremainsPickupSummary appointments={[pickup({ ...allDayWindowFor('2020-01-03', 'America/New_York') })]} />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText(/expected date has passed/i)).toBeInTheDocument();
  });

  it('points staff at the row actions rather than duplicating them', () => {
    render(<CremainsPickupSummary appointments={[pickup()]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/mark the cremains received/i)).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('formats a local date without any timezone conversion', () => {
    // A UTC-midnight anchor must not render as the previous day.
    expect(formatPickupDate('2026-10-16')).toBe('Friday, October 16, 2026');
    expect(formatPickupDate('2027-01-01')).toBe('Friday, January 1, 2027');
  });

  it('returns malformed input unchanged rather than guessing', () => {
    expect(formatPickupDate('not-a-date')).toBe('not-a-date');
  });

  it('extracts the paperwork date from the automation note, whatever its casing', () => {
    expect(paperworkDateFromNotes('AUTOMATICALLY SCHEDULED … ON 2026-10-08.')).toBe('2026-10-08');
    expect(paperworkDateFromNotes(null)).toBeNull();
    expect(paperworkDateFromNotes('a staff note with no date')).toBeNull();
  });
});
