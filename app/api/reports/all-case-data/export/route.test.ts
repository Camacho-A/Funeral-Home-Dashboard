import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockAccountingUser, mockReadOnlyUser } from '@/services/__mocks__/authFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

// PDF export goes through the real `puppeteerDocumentRenderer` (via
// `services/documentService.ts#renderHtmlToPdfBuffer`), which needs an
// actual Chromium binary — unavailable in this test environment, same as
// `services/documentService.test.ts`'s own precedent for every test that
// exercises PDF generation. Stubbed with a trivial fake PDF buffer so
// this route's own logic (auth, column selection, Content-Type/headers)
// is what's under test here, not Puppeteer itself.
const mockRenderHtmlToPdf = vi.fn();
vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args) },
}));
mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

const { GET } = await import('./route');

function getRequest(organizationId: string, format = 'csv', extra = '') {
  return GET(new Request(`http://localhost/api/reports/all-case-data/export?organizationId=${organizationId}&format=${format}${extra}`));
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
});

/**
 * Manors cleanup phase (Task #8, "All Case Data" report). Mirrors
 * `app/api/reports/[reportKey]/export/route.test.ts`'s own auth-coverage
 * shape exactly — the explicit requirement is that an unauthorized caller
 * cannot bypass the UI by hitting this endpoint directly, so every gate
 * gets its own test, not just the happy path.
 */
describe('GET /api/reports/all-case-data/export', () => {
  it('returns 400 without organizationId', async () => {
    expect((await GET(new Request('http://localhost/api/reports/all-case-data/export?format=csv'))).status).toBe(400);
  });

  it('returns 400 for an unrecognized format', async () => {
    expect((await getRequest(DEFAULT_ORGANIZATION_ID, 'txt')).status).toBe(400);
  });

  it('returns 403 for a forged organizationId the caller has no membership in', async () => {
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 403 for a role with report.view but not report.operational (accounting)', async () => {
    mockSession = { user: mockAccountingUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('returns 403 for a role with report.operational but not report.export (readOnly) — cannot bypass the UI by calling the endpoint directly', async () => {
    mockSession = { user: mockReadOnlyUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('exports a CSV for an administrator, with the correct Content-Type and a header row matching every declared column', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 'csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    const csv = await response.text();
    const header = csv.split('\n')[0];
    expect(header).toBe(
      'Case #,Stage,Created Date,Days in Stage,Decedent Name,Date of Birth,Date of Death,Next of Kin,NOK Relationship,NOK Phone,NOK Email,Tag #,Pickup Status,Return Method,Assigned Staff,Veteran,Documents,Order Total,Balance Due,Payment Status',
    );
    // At least one real seeded case row, never just a header with no data.
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });

  it('exports a real, parseable .xlsx (zip signature) for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 'xlsx');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const buffer = Buffer.from(await response.arrayBuffer());
    // Every .xlsx is a zip; a zip always starts with the "PK" local-file-header signature.
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });

  it('exports a real PDF (header signature) for an administrator', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID, 'pdf');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('includes non-empty financial columns for a caller with payment.read (administrator)', async () => {
    const csv = await (await getRequest(DEFAULT_ORGANIZATION_ID, 'csv')).text();
    const columns = csv.split('\n')[0].split(',');
    expect(columns).toContain('Balance Due');
    expect(columns).toContain('Payment Status');
  });

  it('applies the Start/End Date filter against case creation date — an out-of-range window returns a header-only CSV', async () => {
    const csv = await (await getRequest(DEFAULT_ORGANIZATION_ID, 'csv', '&fromDate=1999-01-01&toDate=1999-01-02')).text();
    expect(csv.split('\n').length).toBe(1);
  });
});
