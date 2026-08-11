import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The structural
 * tests promised throughout this phase's implementation, mirroring
 * `services/financialStructuralBoundaries.test.ts`'s exact pattern:
 * "only the designated service writes to `reportPresets`," "no reports
 * route/UI/client file touches Wix directly," and "no route file
 * recomputes a metric or view model itself instead of delegating to
 * `reportingService.ts`."
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, results);
    } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

const root = join(__dirname, '..');
const allFiles = walk(root);

describe('Reporting collection writer (structural)', () => {
  it('only reportPresetService.ts writes to "reportPresets" directly', () => {
    const writerPath = join(__dirname, 'reportPresetService.ts');
    const writePattern = /(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\(\s*['"]reportPresets['"]/;
    const offenders = allFiles.filter((filePath) => filePath !== writerPath && writePattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `unexpected writer(s) of "reportPresets": ${offenders.join(', ')}`).toEqual([]);
  });

  it('only reportPresetService.ts deletes from "reportPresets" directly', () => {
    const writerPath = join(__dirname, 'reportPresetService.ts');
    const deletePattern = /deleteWixDataItem\(\s*['"]reportPresets['"]/;
    const offenders = allFiles.filter((filePath) => filePath !== writerPath && deletePattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `unexpected deleter(s) of "reportPresets": ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Reporting UI/route no-direct-Wix boundary (structural)', () => {
  const reportingSurfaceFiles = allFiles.filter(
    (filePath) =>
      filePath.includes(`${sep}app${sep}api${sep}reports${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}dashboard${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}metrics${sep}`) ||
      filePath.includes(`${sep}app${sep}api${sep}report-presets${sep}`) ||
      filePath.includes(`${sep}components${sep}reports${sep}`) ||
      filePath.includes(`${sep}components${sep}charts${sep}`) ||
      filePath.endsWith(`${sep}hooks${sep}useReports.ts`) ||
      filePath.endsWith(`${sep}hooks${sep}useDashboard.ts`) ||
      filePath.endsWith(`${sep}lib${sep}reportsClient.ts`),
  );

  it('found at least one reporting surface file to check (sanity check on the walk itself)', () => {
    expect(reportingSurfaceFiles.length).toBeGreaterThan(0);
  });

  it('no reporting route/UI/client file imports lib/wixDataApi or calls its functions directly', () => {
    const forbiddenPattern = /from ['"][^'"]*wixDataApi['"]|(?:insertWixDataItem|updateWixDataItem|queryWixDataItems|deleteWixDataItem)\s*\(/;
    const offenders = reportingSurfaceFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `file(s) touching Wix Data directly: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Reporting routes never recompute a metric or report themselves (structural)', () => {
  const reportRouteFiles = allFiles.filter(
    (filePath) =>
      (filePath.includes(`${sep}app${sep}api${sep}reports${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}dashboard${sep}`) ||
        filePath.includes(`${sep}app${sep}api${sep}metrics${sep}`)) &&
      filePath.endsWith(`${sep}route.ts`),
  );

  it('found at least one report route file to check (sanity check on the walk itself)', () => {
    expect(reportRouteFiles.length).toBeGreaterThan(0);
  });

  // A route recomputing a metric itself would need to build case view
  // models, scan journal entries/ledger lines, or reach into fixture/mock
  // arrays directly — every one of those is reportingService.ts's job
  // alone. Routes are only ever allowed to call into the reporting
  // service layer (reportingService/dashboardService/reportExportService/
  // reportPresetService/the two registries) and generic route
  // infrastructure (NextResponse, auth, permission checks).
  it('no report/dashboard/metrics route imports domain/cases/viewModel, domain/reports/calculations, or the ledger/GL services directly', () => {
    const forbiddenImportPattern =
      /from ['"][^'"]*(domain\/cases\/viewModel|domain\/reports\/calculations|generalLedgerService|financialReportsService|chartOfAccountsService|casesService|tasksService|staffProfileService|scheduling\/appointmentReads|resourceService|documentService|signatureService|paymentsService|activityService|pricingService|notificationService)['"]/;
    const offenders = reportRouteFiles.filter((filePath) => forbiddenImportPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `route(s) importing a domain service directly instead of going through reportingService.ts: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every report/dashboard/metrics route imports from the reporting service layer (the service itself, or — for the pure listing route — its registry)', () => {
    const reportingLayerImportPattern = /from ['"](@\/services\/(reportingService|dashboardService|reportExportService|reportPresetService)|@\/domain\/reporting\/(reportRegistry|metricRegistry))['"]/;
    const offenders = reportRouteFiles.filter((filePath) => !reportingLayerImportPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `route(s) not delegating to the reporting service layer: ${offenders.join(', ')}`).toEqual([]);
  });
});
