import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser } from '@/services/__mocks__/authFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import type { Case } from '@/types/case';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));
const { canEditCase } = vi.hoisted(() => ({ canEditCase: vi.fn(async () => true) }));
vi.mock('@/services/authorizationPolicyService', async () => {
  const actual = await vi.importActual<typeof import('@/services/authorizationPolicyService')>('@/services/authorizationPolicyService');
  return { ...actual, canEditCase };
});

const { POST } = await import('./route');

const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
function post(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return POST(new Request('http://localhost/api/cases/1042/sla', { method: 'POST', headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ caseId: '1042' }),
  });
}

const index = caseFixtures.findIndex((c) => c.id === '1042');
const original: Case = caseFixtures[index];
afterEach(() => {
  caseFixtures[index] = original;
  vi.clearAllMocks();
  mockSession = { user: mockDefaultUser };
});

describe('POST /api/cases/[caseId]/sla', () => {
  it('records an event for staff who can edit the case', async () => {
    const response = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at });
    expect(response.status).toBe(200);
    expect((await response.json()).case.slaEvents.approval_received.at).toBe(at);
    expect(canEditCase).toHaveBeenCalled();
  });

  it('records and resolves a delay', async () => {
    const recorded = await (await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_delay', milestone: 'approval', reason: 'other', notes: 'State backlog' })).json();
    const [delayId] = Object.keys(recorded.case.slaDelays);
    const resolved = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'resolve_delay', delayId });
    expect((await resolved.json()).case.slaDelays[delayId].resolution).toBe('resolved');
  });

  it('refuses an archived case, a future time, and an unknown action', async () => {
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at: new Date(Date.now() + 864e5).toISOString() })).status).toBe(422);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'explode' })).status).toBe(400);
    caseFixtures[index] = { ...original, isDeleted: true };
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at })).status).toBe(409);
  });

  it('refuses a caller without case edit permission, without a session, or from another site', async () => {
    canEditCase.mockResolvedValueOnce(false);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at })).status).toBe(403);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at }, { origin: 'https://evil.example', host: 'localhost' })).status).toBe(403);
    mockSession = null;
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'record_event', event: 'approval_received', at })).status).toBe(401);
    expect(caseFixtures[index].slaEvents?.approval_received).toBeUndefined();
  });
});
