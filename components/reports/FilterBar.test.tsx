import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import type { StaffProfile } from '@/types/staffProfile';

const staff: StaffProfile = {
  id: 'staff-1',
  organizationId: 'org-1',
  identityId: 'identity-1',
  membershipId: null,
  displayName: 'Dana',
  role: 'funeral_director',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('FilterBar', () => {
  it('renders nothing when the report allows no filters', () => {
    const { container } = render(<FilterBar allowedFilters={[]} values={{}} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders date fields only when dateRange is allowed', () => {
    render(<FilterBar allowedFilters={['dateRange']} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.queryByText('Staff')).not.toBeInTheDocument();
  });

  it('renders a staff dropdown only when staff filtering is allowed and a staff list is given', () => {
    render(<FilterBar allowedFilters={['staff']} values={{}} onChange={vi.fn()} staffList={[staff]} />);
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });

  it('calls onChange with an ISO start-of-day date when the From field changes', () => {
    const onChange = vi.fn();
    render(<FilterBar allowedFilters={['dateRange']} values={{}} onChange={onChange} />);
    const [fromInput] = screen.getAllByDisplayValue('');
    fireEvent.change(fromInput, { target: { value: '2026-07-01' } });
    expect(onChange).toHaveBeenCalledWith({ fromDate: '2026-07-01T00:00:00.000Z' });
  });
});
