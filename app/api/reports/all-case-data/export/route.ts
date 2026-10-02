import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { hasPermission } from '@/services/permissionService';
import { canViewReports, canExportReports, canReadPayment } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { buildAllCaseDataRows, exportAllCaseDataCsv, exportAllCaseDataXlsx, exportAllCaseDataPdf } from '@/services/allCaseDataReportService';

const FORMATS = ['csv', 'xlsx', 'pdf'] as const;
type Format = (typeof FORMATS)[number];

function isFormat(value: string | null): value is Format {
  return value !== null && (FORMATS as readonly string[]).includes(value);
}

/**
 * Manors cleanup phase (Task #8, "All Case Data" report). Same three-gate
 * server-side authorization every other report export route already uses
 * (`app/api/reports/[reportKey]/export/route.ts`) — `report.view` → the
 * report's own `report.operational` permission → `report.export` — so a
 * staff member who can't see this report in the UI cannot reach real data
 * by calling this endpoint directly. FINANCIAL columns (order total,
 * balance due, payment status) are populated only when the caller
 * additionally holds `payment.read` — mirroring `CaseOrderCard`'s own
 * precedent that financial figures need a narrower grant than general
 * case-operational data; an unauthorized caller gets every other column
 * with blank financial cells, never a request rejection over a report
 * most of whose columns they ARE allowed to see.
 *
 * Exports the FULL filtered result set (capped only by the same,
 * disclosed `EXPORT_ROW_CAP` every other export in this codebase already
 * applies — never a silent, undisclosed page-1-of-N truncation).
 *
 * This route only ever imports from `services/allCaseDataReportService.ts`
 * (plus generic auth/route infrastructure) — never a domain service or
 * the concrete PDF renderer directly — matching
 * `services/reportsStructuralBoundaries.test.ts`'s "every report route
 * delegates to the reporting service layer" rule exactly.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  const format = url.searchParams.get('format');
  if (!isFormat(format)) {
    return NextResponse.json({ error: `format must be one of: ${FORMATS.join(', ')}.` }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  if (!(await canViewReports(policyParams, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view reports for this organization.' }, { status: 403 });
  }
  if (!(await hasPermission(policyParams, dataAdapterMode, 'report.operational'))) {
    return NextResponse.json({ error: 'Not authorized to view the "all-case-data" report.' }, { status: 403 });
  }
  if (!(await canExportReports(policyParams, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to export reports for this organization.' }, { status: 403 });
  }
  const includeFinancial = await canReadPayment(policyParams, dataAdapterMode);

  const filters = { fromDate: url.searchParams.get('fromDate') ?? undefined, toDate: url.searchParams.get('toDate') ?? undefined };
  const rows = await buildAllCaseDataRows(organizationId, filters, includeFinancial, dataAdapterMode);

  if (format === 'csv') {
    return new NextResponse(exportAllCaseDataCsv(rows), {
      status: 200,
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="all-case-data.csv"' },
    });
  }

  if (format === 'xlsx') {
    const buffer = await exportAllCaseDataXlsx(rows);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="all-case-data.xlsx"',
      },
    });
  }

  const pdfBuffer = await exportAllCaseDataPdf(organizationId, rows, filters, dataAdapterMode);
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="all-case-data.pdf"' },
  });
}
