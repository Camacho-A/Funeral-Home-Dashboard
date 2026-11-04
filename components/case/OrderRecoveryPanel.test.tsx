import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderRecoveryPanel } from './OrderRecoveryPanel';

/** Order recovery (2026-11) — the administrator's panel. Fictional data. */

const operation = {
  operationId: 'order-fictional-v2',
  caseId: 'case-fictional-1',
  status: 'prepared',
  startedAt: '2026-11-03T15:00:00.000Z',
  updatedAt: '2026-11-03T15:00:01.000Z',
  startedBy: 'identity-fictional',
  details: { kind: 'edit', previousOrderId: 'order-fictional-v1', previousVersion: 1, plannedOrderId: 'order-fictional-v2', plannedVersion: 2, plannedTotal: 185_000 },
  interrupted: true,
  inspection: {
    plannedStatus: 'pending',
    previousStatus: 'superseded',
    activeOrderId: null,
    otherActiveOrderId: null,
    revenue: 'not_posted',
    missingAuditEntries: 2,
    allowedActions: ['complete', 'roll_back'],
    summary: 'The previous version was replaced but the new one was never put in effect, so the case is locked.',
  },
};

let calls: Array<{ url: string; init?: RequestInit }> = [];
function stub(repair: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { resolved: true } }) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return Promise.resolve({ ok: repair.ok, status: repair.status, json: async () => repair.body });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ operations: [operation] }) });
    }),
  );
}

const renderPanel = (canRecover: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OrderRecoveryPanel organizationId="managed-cremations" caseId="case-fictional-1" caseName="Jordan Fictional" caseNumber="B2026-999" canRecover={canRecover} />
    </QueryClientProvider>,
  );

beforeEach(() => stub());
afterEach(() => vi.unstubAllGlobals());

describe('OrderRecoveryPanel', () => {
  it('staff without recovery rights see only that an administrator must recover it — nothing is fetched', () => {
    renderPanel(false);
    expect(screen.getByText(/An administrator must recover this order/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("an administrator sees the case, the change, the order's state and why — for this case only", async () => {
    renderPanel(true);
    expect(await screen.findByText(/Change from version 1 to version 2/)).toBeTruthy();
    expect(screen.getByText(/Jordan Fictional · Case #B2026-999/)).toBeTruthy();
    expect(screen.getByText('saved, not in effect')).toBeTruthy();
    expect(screen.getByText('Not posted')).toBeTruthy();
    expect(screen.getByText(/Why recovery is needed: The previous version was replaced/)).toBeTruthy();
    expect(calls[0].url).toContain('caseId=case-fictional-1');
  });

  it('a repair needs an explicit confirmation, then calls the repair API once and reloads', async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete the change' }));
    const confirm = screen.getByRole('button', { name: 'Confirm: Complete the change' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('/api/cases/order-operations/order-fictional-v2');
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ organizationId: 'managed-cremations', action: 'complete' });
    expect(await screen.findByText(/Complete the change: done/)).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => !c.init?.method).length).toBeGreaterThan(1)); // report reloaded
  });

  it('a refusal from the server (e.g. another administrator got there first) is shown', async () => {
    stub({ ok: false, status: 409, body: { error: 'Another repair of this operation is in progress. Reload and try again in a few minutes.' } });
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Roll back the change' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: Roll back the change' }));
    expect(await screen.findByText(/Another repair of this operation is in progress/)).toBeTruthy();
  });
});
