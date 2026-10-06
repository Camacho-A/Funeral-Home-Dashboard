import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';
import { staffFixtures, caseLogFixtures } from '@/services/__mocks__/fixtures';


/**
 * Author attribution (2026-10). This route had no test file at all — the
 * gap that let a misattribution bug ship: the body's `author` was trusted
 * verbatim, and the Case Detail page sent the case's ASSIGNED OWNER
 * rather than the person writing, so entries were credited to the wrong
 * staff member and to the literal string "Office" on any unassigned
 * case. The server now resolves the author from the authenticated
 * caller's own StaffProfile, and these tests pin that down — including
 * that a client claim can no longer influence it.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, POST } = await import('./route');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function postEntry(caseId: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN) {
  return POST(
    new Request(`http://localhost/api/cases/${caseId}/log`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ caseId }) },
  );
}

function getEntries(caseId: string, organizationId: string | null) {
  const params = new URLSearchParams(organizationId ? { organizationId } : {});
  return GET(new Request(`http://localhost/api/cases/${caseId}/log?${params.toString()}`), {
    params: Promise.resolve({ caseId }),
  });
}

/**
 * Mock fixtures deliberately keep login identities and StaffProfiles
 * unlinked (see authFixtures.ts: "two type systems... the same person
 * without being the same concept"), so nothing resolves a profile for
 * mockDefaultUser by default. This links one explicitly, the way the
 * real `staffProfiles` collection does in production via identityId.
 *
 * The name is deliberately NOT staffFixtures[0]'s ("Dana", who owns the
 * seeded cases): if an entry ever comes back as "Dana", that is the old
 * assigned-owner attribution, not the caller.
 */
const CALLER_NAME = 'Morgan Reyes';
const CALLER_PROFILE = {
  ...staffFixtures[0],
  id: 'staff-log-author-test',
  identityId: mockDefaultUser.id,
  displayName: CALLER_NAME,
};

beforeEach(() => {
  mockSession = { user: mockDefaultUser };
  caseLogFixtures.length = 0;
  staffFixtures.push(CALLER_PROFILE);
});

afterEach(() => {
  const index = staffFixtures.findIndex((s) => s.id === CALLER_PROFILE.id);
  if (index !== -1) staffFixtures.splice(index, 1);
  caseLogFixtures.length = 0;
});

describe('POST /api/cases/[caseId]/log — author attribution', () => {
  it('attributes the entry to the authenticated caller', async () => {
    const response = await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry.author).toBe(CALLER_NAME);
  });

  it('ignores an author supplied in the body — the browser cannot name the author', async () => {
    const response = await postEntry('case-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      type: 'note',
      text: 'A note',
      author: 'Somebody Else',
    });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry.author).toBe(CALLER_NAME);
    expect(entry.author).not.toBe('Somebody Else');
  });

  it('never attributes an entry to the case owner, the bug this replaced', async () => {
    const response = await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' });
    const { entry } = await response.json();
    expect(entry.author).toBe(CALLER_NAME);
    // "Dana" owns the seeded cases. Seeing that here would mean the
    // assigned-owner attribution had crept back in.
    expect(entry.author).not.toBe('Dana');
    expect(entry.author).not.toBe('Office');
  });

  it('no longer requires author in the body — a request without one succeeds', async () => {
    const response = await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' });
    expect(response.status).toBe(201);
  });

  it('attributes a contact entry the same way', async () => {
    const response = await postEntry('case-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
      type: 'contact',
      contactedWho: 'Hospice',
      contactedSpoke: 'Nurse Adams',
      contactSummary: 'Confirmed pickup window',
    });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry.author).toBe(CALLER_NAME);
    // Normalized to ALL CAPS by caseLogService, per the SOLIS data standard.
    expect(entry.contactedWho).toBe('HOSPICE');
  });

  it('falls back to "Office" when the caller has no StaffProfile, rather than losing the note', async () => {
    // mockMultiOrgUser is a member of SECOND_MOCK_ORGANIZATION_ID but has
    // no staffProfile fixture there.
    mockSession = { user: mockMultiOrgUser };
    const response = await postEntry('case-1', { organizationId: SECOND_MOCK_ORGANIZATION_ID, type: 'note', text: 'A note' });
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry.author).toBe('Office');
  });
});

describe('POST /api/cases/[caseId]/log — validation and authorization', () => {
  it('requires organizationId', async () => {
    expect((await postEntry('case-1', { type: 'note', text: 'A note' })).status).toBe(400);
  });

  it('rejects an invalid type', async () => {
    const response = await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'shout', text: 'x' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid JSON body', async () => {
    const response = await POST(
      new Request('http://localhost/api/cases/case-1/log', { method: 'POST', headers: SAME_ORIGIN, body: 'not json' }),
      { params: Promise.resolve({ caseId: 'case-1' }) },
    );
    expect(response.status).toBe(400);
  });

  it('requires a same-origin request', async () => {
    const response = await postEntry(
      'case-1',
      { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' },
      { origin: 'http://evil.test', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
    expect(caseLogFixtures).toHaveLength(0);
  });

  it('refuses a caller without case-edit permission, writing nothing', async () => {
    mockSession = { user: mockReadOnlyUser };
    const response = await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' });
    expect(response.status).toBe(403);
    expect(caseLogFixtures).toHaveLength(0);
  });
});

describe('GET /api/cases/[caseId]/log', () => {
  it('requires organizationId', async () => {
    expect((await getEntries('case-1', null)).status).toBe(400);
  });

  it('returns entries created for that case, carrying the resolved author', async () => {
    await postEntry('case-1', { organizationId: DEFAULT_ORGANIZATION_ID, type: 'note', text: 'A note' });
    const response = await getEntries('case-1', DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const { entries } = await response.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe(CALLER_NAME);
  });
});
