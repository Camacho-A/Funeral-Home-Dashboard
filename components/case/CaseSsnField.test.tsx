import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseSsnField } from './CaseSsnField';

/** Case SSN in Case Information (2026-10): last four only, locked; administrators correct with a reason. */
const perms = vi.hoisted(() => ({ list: ['case.read'] as string[] }));
vi.mock('@/hooks/useRbac', () => ({ useMyPermissions: () => ({ isSuccess: true, data: { permissions: perms.list } }) }));
const client = vi.hoisted(() => ({ correctCaseSsn: vi.fn() }));
vi.mock('@/lib/caseSsnClient', () => client);

const summary = { last4: '3456', source: 'arrangement_form' as const, capturedAt: '2026-10-28T12:00:00.000Z', correctedAt: null };
const renderField = (ssnOnFile: typeof summary | null = summary, readOnly = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CaseSsnField organizationId="managed-cremations" caseId="1042" ssnOnFile={ssnOnFile} readOnly={readOnly} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  perms.list = ['case.read'];
  client.correctCaseSsn.mockReset();
});

describe('CaseSsnField', () => {
  it('shows only the last four, locked, with its source on hover (compact, 2026-10) — and no edit for staff', () => {
    renderField();
    expect(screen.getByText(/•••-••-3456/)).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByTitle(/^From the Arrangement Form/)).toBeTruthy();
    expect(screen.queryByText('From the Arrangement Form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct…' })).toBeNull();
  });

  it('says when none is on file yet', () => {
    renderField(null);
    expect(screen.getByText(/Not on file/)).toBeTruthy();
  });

  it('an administrator can correct it, with a reason; Save stays disabled until both are valid', async () => {
    perms.list = ['case.read', 'organization.manage'];
    client.correctCaseSsn.mockResolvedValue({ ...summary, last4: '1111', source: 'admin_correction' });
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Correct…' }));
    const save = screen.getByRole('button', { name: 'Save and lock' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Social Security number'), { target: { value: '000-55-1111' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Typo on the Arrangement Form' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(client.correctCaseSsn).toHaveBeenCalledWith({ organizationId: 'managed-cremations', caseId: '1042', ssn: '000-55-1111', reason: 'Typo on the Arrangement Form' }));
  });

  it('no correction on an archived (read-only) case', () => {
    perms.list = ['organization.manage'];
    renderField(summary, true);
    expect(screen.queryByRole('button', { name: 'Correct…' })).toBeNull();
  });
});
