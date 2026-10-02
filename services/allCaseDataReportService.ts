import type { DataAdapterMode } from '../lib/env';
import type { Case } from '../types/case';
import { listForOrganization as listCasesForOrganization } from './casesService';
import { list as listStaffProfiles } from './staffProfileService';
import { listActiveCaseOrdersForOrganization } from './pricingService';
import { listForOrganization as listDocumentsForOrganization, renderHtmlToPdfBuffer } from './documentService';
import { getForOrganization as getOrganization } from './organizationsService';
import { STAGES, toDisplayStage } from '../domain/cases/stages';
import { caseOrderBalanceStatusLabel } from '../domain/cases/paymentDisplay';
import { formatCentsAsCurrency } from '../utils/format';
import { buildCsv, EXPORT_ROW_CAP } from '../domain/reporting/csvExport';
import { buildAllCaseDataXlsx } from '../domain/reporting/allCaseDataExcelExport';
import { buildAllCaseDataPdfHtml } from '../domain/reporting/allCaseDataPdfExport';

/**
 * Manors cleanup phase (Task #8, "All Case Data" report). The one shared,
 * filtered dataset every export format (CSV/Excel/PDF) serializes from —
 * built once per request, never three independent re-derivations. Mirrors
 * `services/activityService.ts#attachActorDisplayNames`'s "one batched
 * lookup per unique id, never N+1" discipline for every joined entity
 * below (staff, case orders, payments, documents) — all four are fetched
 * org-wide ONCE via their existing bulk functions and indexed by id/caseId
 * in memory, regardless of how many cases are in range.
 *
 * Field selection follows the explicit request: operationally useful
 * case-level data only — no internal ids (beyond the human-facing case
 * number), no raw workflow/checklist JSON, no audit/technical metadata.
 * `completed date` was explicitly requested but is NOT included: `Case`
 * has no persisted completion timestamp anywhere in this data model
 * (`daysWaitingInStage` is documented as "mock-static," not a real
 * stage-entry history) — inventing one would mean fabricating data, which
 * this phase's own instructions explicitly forbid elsewhere (statement
 * totals). Reported as a known gap rather than silently guessed at.
 */
export type AllCaseDataFilters = {
  /** Filters on `Case.createdAt` (case creation date) — the default and
      only supported semantics for this report; see this file's own
      `DATE_FILTER_FIELD` constant for why this was chosen over
      `dateOfDeath`. Both ISO date strings (YYYY-MM-DD), inclusive. */
  fromDate?: string;
  toDate?: string;
};

/** The exact case-date field this report's Start/End Date filter applies
    to — case CREATION date, not date of death. Chosen because (a) every
    case has one (dateOfDeath can be entered late or amended; createdAt is
    set once, automatically, by the server at intake and never missing),
    and (b) it matches the one other report in this codebase that already
    filters on a plain case date range ('case-intake-volume', `cases.created`
    metric, `domain/reporting/reportRegistry.ts`) — the closest existing
    convention, so this report's date range reads the same way a Manors
    staff member already expects from that one. Surfaced in the exported
    column header and the UI's own filter labels so the meaning is never
    ambiguous. */
export const DATE_FILTER_FIELD = 'createdAt' as const;

export type AllCaseDataRow = {
  caseNumber: string;
  stage: string;
  createdAt: string;
  daysInStage: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  nextOfKinName: string;
  nextOfKinRelationship: string;
  nextOfKinPhone: string;
  nextOfKinEmail: string;
  tagNumber: string;
  pickupStatus: string;
  returnMethod: string;
  assignedStaffName: string;
  isVeteran: string;
  documentsSummary: string;
  orderTotal: string;
  balanceDue: string;
  paymentStatus: string;
};

export type AllCaseDataColumn = { key: keyof AllCaseDataRow; header: string; value: (row: AllCaseDataRow) => string };

/** Shared by every exporter (CSV/Excel/PDF) — one definition, one order.
    FINANCIAL columns are only ever POPULATED (not omitted as columns —
    every export keeps the same column set regardless of caller) when the
    caller holds `payment.read`; see `buildAllCaseDataRows`'s
    `includeFinancial` parameter. An unauthorized caller sees empty cells,
    never a 403 mid-row and never real figures smuggled through. */
export const ALL_CASE_DATA_COLUMNS: readonly AllCaseDataColumn[] = [
  { key: 'caseNumber', header: 'Case #', value: (r) => r.caseNumber },
  { key: 'stage', header: 'Stage', value: (r) => r.stage },
  { key: 'createdAt', header: 'Created Date', value: (r) => r.createdAt },
  { key: 'daysInStage', header: 'Days in Stage', value: (r) => r.daysInStage },
  { key: 'decedentName', header: 'Decedent Name', value: (r) => r.decedentName },
  { key: 'dateOfBirth', header: 'Date of Birth', value: (r) => r.dateOfBirth },
  { key: 'dateOfDeath', header: 'Date of Death', value: (r) => r.dateOfDeath },
  { key: 'nextOfKinName', header: 'Next of Kin', value: (r) => r.nextOfKinName },
  { key: 'nextOfKinRelationship', header: 'NOK Relationship', value: (r) => r.nextOfKinRelationship },
  { key: 'nextOfKinPhone', header: 'NOK Phone', value: (r) => r.nextOfKinPhone },
  { key: 'nextOfKinEmail', header: 'NOK Email', value: (r) => r.nextOfKinEmail },
  { key: 'tagNumber', header: 'Tag #', value: (r) => r.tagNumber },
  { key: 'pickupStatus', header: 'Pickup Status', value: (r) => r.pickupStatus },
  { key: 'returnMethod', header: 'Return Method', value: (r) => r.returnMethod },
  { key: 'assignedStaffName', header: 'Assigned Staff', value: (r) => r.assignedStaffName },
  { key: 'isVeteran', header: 'Veteran', value: (r) => r.isVeteran },
  { key: 'documentsSummary', header: 'Documents', value: (r) => r.documentsSummary },
  { key: 'orderTotal', header: 'Order Total', value: (r) => r.orderTotal },
  { key: 'balanceDue', header: 'Balance Due', value: (r) => r.balanceDue },
  { key: 'paymentStatus', header: 'Payment Status', value: (r) => r.paymentStatus },
];

function pickupStatusLabel(c: Case): string {
  return c.pickupStatus === 'released' ? 'Released' : 'Awaiting Pickup';
}

function returnMethodLabel(c: Case): string {
  if (c.returnMethod === 'pickup') return 'Pickup';
  if (c.returnMethod === 'shipping') return 'Shipping';
  return 'Undecided';
}

/** MM/DD/YYYY — consistent, locale-stable date-only formatting shared by
    every export format (Excel in particular benefits from a plain,
    unambiguous string rather than a raw ISO timestamp with a time
    component nobody asked for in a report). */
function formatReportDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function nextOfKinRelationshipLabel(c: Case): string {
  if (!c.nextOfKinRelationship) return '';
  if (c.nextOfKinRelationship === 'other') return c.nextOfKinRelationshipOther ?? 'Other';
  return c.nextOfKinRelationship.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export async function buildAllCaseDataRows(
  organizationId: string,
  filters: AllCaseDataFilters,
  includeFinancial: boolean,
  dataAdapterMode: DataAdapterMode,
): Promise<AllCaseDataRow[]> {
  const [allCases, staff, activeOrders, documents] = await Promise.all([
    listCasesForOrganization(organizationId, dataAdapterMode),
    listStaffProfiles(organizationId, dataAdapterMode),
    includeFinancial ? listActiveCaseOrdersForOrganization(organizationId, dataAdapterMode) : Promise.resolve([]),
    listDocumentsForOrganization(organizationId, dataAdapterMode),
  ]);

  const staffNameById = new Map(staff.map((s) => [s.id, s.displayName]));
  const activeOrderByCaseId = new Map(activeOrders.map((o) => [o.caseId, o]));
  const documentsByCaseId = new Map<string, { total: number; signed: number }>();
  for (const d of documents) {
    const entry = documentsByCaseId.get(d.caseId) ?? { total: 0, signed: 0 };
    entry.total += 1;
    if (d.signatureStatus === 'signed') entry.signed += 1;
    documentsByCaseId.set(d.caseId, entry);
  }

  const inRange = allCases.filter((c) => {
    const value = c[DATE_FILTER_FIELD];
    if (filters.fromDate && value < filters.fromDate) return false;
    if (filters.toDate && value > `${filters.toDate}T23:59:59.999Z`) return false;
    return true;
  });

  return inRange.map((c) => {
    const docSummary = documentsByCaseId.get(c.id);
    const order = activeOrderByCaseId.get(c.id) ?? null;

    return {
      caseNumber: c.caseNumber,
      stage: STAGES[toDisplayStage(c.rawStage)] ?? '',
      createdAt: formatReportDate(c.createdAt),
      daysInStage: String(c.daysWaitingInStage),
      decedentName: c.decedentName,
      dateOfBirth: c.dateOfBirth,
      dateOfDeath: c.dateOfDeath,
      nextOfKinName: c.nextOfKinName,
      nextOfKinRelationship: nextOfKinRelationshipLabel(c),
      nextOfKinPhone: c.nextOfKinPhone,
      nextOfKinEmail: c.nextOfKinEmail ?? '',
      tagNumber: c.tagNumber ?? '',
      pickupStatus: pickupStatusLabel(c),
      returnMethod: returnMethodLabel(c),
      assignedStaffName: c.assignedStaffId ? (staffNameById.get(c.assignedStaffId) ?? 'Unknown') : '',
      isVeteran: c.isVeteran ? 'Yes' : 'No',
      documentsSummary: docSummary ? `${docSummary.total} document${docSummary.total === 1 ? '' : 's'} · ${docSummary.signed} signed` : '0 documents',
      orderTotal: includeFinancial ? (order ? formatCentsAsCurrency(order.total, 'usd') : '') : '',
      balanceDue: includeFinancial ? (order ? formatCentsAsCurrency(order.balanceDue, 'usd') : '') : '',
      paymentStatus: includeFinancial ? (order ? caseOrderBalanceStatusLabel(order.balanceDue) : 'No case order') : '',
    };
  });
}

/**
 * The three export-format wrappers below all live in this one service
 * file — not the route — so `app/api/reports/all-case-data/export/route.ts`
 * only ever imports from `allCaseDataReportService` (plus generic
 * NextResponse/auth infrastructure), matching
 * `services/reportsStructuralBoundaries.test.ts`'s "every report route
 * delegates to the reporting service layer, never reaches into a domain
 * service or the concrete PDF renderer directly" rule — the same rule
 * `services/documentService.ts#renderHtmlToPdfBuffer`'s own comment
 * documents from the renderer side.
 */
export function exportAllCaseDataCsv(rows: readonly AllCaseDataRow[]): string {
  return buildCsv(rows.slice(0, EXPORT_ROW_CAP), ALL_CASE_DATA_COLUMNS);
}

export async function exportAllCaseDataXlsx(rows: readonly AllCaseDataRow[]): Promise<Buffer> {
  return buildAllCaseDataXlsx(rows.slice(0, EXPORT_ROW_CAP), ALL_CASE_DATA_COLUMNS);
}

export async function exportAllCaseDataPdf(
  organizationId: string,
  rows: readonly AllCaseDataRow[],
  filters: AllCaseDataFilters,
  dataAdapterMode: DataAdapterMode,
): Promise<Buffer> {
  const organization = await getOrganization(organizationId, dataAdapterMode);
  const html = buildAllCaseDataPdfHtml({
    organizationName: organization?.name ?? organizationId,
    generatedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    rows: rows.slice(0, EXPORT_ROW_CAP),
  });
  return renderHtmlToPdfBuffer(html);
}
