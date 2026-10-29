import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Manatee County — Death Certificate Application route (2026-10):
 * permissions, input checks, and that nothing sensitive is echoed. The
 * service itself is covered in services/manateeApplicationService.test.ts.
 */
let session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
vi.mock('@/lib/auth/requireAuthorizedOrganization', () => ({
  requireAuthorizedOrganization: vi.fn(async (requested: string) =>
    requested !== session.organizationId
      ? { authorized: false, response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }
      : { authorized: true, context: { organizationId: requested, userId: session.userId, role: session.role } },
  ),
}));
const permissions = vi.hoisted(() => ({ read: true, generate: true }));
vi.mock('@/services/authorizationPolicyService', async () => ({
  ...(await vi.importActual<object>('@/services/authorizationPolicyService')),
  canReadCases: vi.fn(async () => permissions.read),
  canGenerateDocument: vi.fn(async () => permissions.generate),
}));
const service = vi.hoisted(() => ({
  getManateeApplicationDraft: vi.fn(),
  previewManateeApplication: vi.fn(),
  saveManateeApplication: vi.fn(),
}));
vi.mock('@/services/manateeApplicationService', async () => {
  const actual = await vi.importActual<typeof import('@/services/manateeApplicationService')>('@/services/manateeApplicationService');
  return { ...actual, ...service };
});

const { GET, POST } = await import('./route');
const { ManateeApplicationError } = await import('@/services/manateeApplicationService');

const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
const params = { params: Promise.resolve({ caseId: '1042' }) };
const values = {
  decedentFirst: 'Mary Ann', decedentMiddle: '', decedentLast: 'Salas Rueda', decedentSex: 'F', ssnNotKnown: false, ssn: '000-12-3456',
  dateOfDeath: '10/04/2026', placeOfDeathCity: 'Pembroke Pines', placeOfDeathCounty: 'Broward',
  spouseFirst: '', spouseMiddle: '', spouseLast: '', representedName: 'Teresa', representedRelationship: 'Daughter',
  withCause: 1, withoutCause: 0, fedexFee: false,
};
const post = (body: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request('http://localhost/api/cases/1042/documents/manatee-application', { method: 'POST', headers, body: JSON.stringify(body) }), params);

beforeEach(() => {
  Object.assign(permissions, { read: true, generate: true });
  service.getManateeApplicationDraft.mockResolvedValue({ values: {}, ssn: { onFile: true, masked: '•••-••-3456', source: 'arrangement_form' } });
  service.previewManateeApplication.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  service.saveManateeApplication.mockResolvedValue({ id: 'doc-1', fileName: 'Manatee County Death Certificate Application.pdf' });
});
afterEach(() => {
  session = { organizationId: DEFAULT_ORGANIZATION_ID, userId: 'identity-admin', role: 'administrator' };
  vi.restoreAllMocks();
});

describe('Manatee County application route', () => {
  it('GET returns the draft, never cached', async () => {
    const response = await GET(new Request(`http://localhost/x?organizationId=${DEFAULT_ORGANIZATION_ID}`), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('needs case read AND document permission', async () => {
    permissions.generate = false;
    expect((await GET(new Request(`http://localhost/x?organizationId=${DEFAULT_ORGANIZATION_ID}`), params)).status).toBe(403);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values })).status).toBe(403);
    expect(service.saveManateeApplication).not.toHaveBeenCalled();
  });

  it('another organization is refused', async () => {
    expect((await post({ organizationId: 'some-other-org', action: 'save', values })).status).toBe(403);
  });

  it('refuses a cross-site request and malformed input', async () => {
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values }, { ...SAME_ORIGIN, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'send', values })).status).toBe(400);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values: { ...values, withCause: '2' } })).status).toBe(400);
    expect((await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values: { ...values, fedexFee: 'yes' } })).status).toBe(400);
  });

  it('preview returns the PDF inline and uncached; save returns 201', async () => {
    const preview = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'preview', values });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    expect(preview.headers.get('cache-control')).toBe('no-store');
    const saved = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values });
    expect(saved.status).toBe(201);
    expect(service.saveManateeApplication.mock.calls[0][2]).toMatchObject({ ssn: '000-12-3456', withCause: 1 });
  });

  it('a service refusal keeps its status; an unexpected failure never logs or returns the values', async () => {
    service.saveManateeApplication.mockRejectedValueOnce(new ManateeApplicationError('Enter the county of death.', 422));
    const refused = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values });
    expect(refused.status).toBe(422);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.saveManateeApplication.mockRejectedValueOnce(new Error('boom 000-12-3456'));
    const failed = await post({ organizationId: DEFAULT_ORGANIZATION_ID, action: 'save', values });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('3456');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('3456');
  });
});
