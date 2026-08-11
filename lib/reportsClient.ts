import type { ReportDefinition, ReportCategory } from '@/domain/reporting/reportRegistry';
import type { MetricDefinition } from '@/domain/reporting/metricRegistry';
import type { ReportRunResult, ReportFilters } from '@/services/reportingService';
import type { DashboardResult } from '@/services/dashboardService';
import type { ReportPreset } from '@/types/reportPreset';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Client-side
 * fetch wrappers around `/api/reports`, `/api/dashboard`,
 * `/api/metrics/*`, and `/api/report-presets` — matches every other
 * `lib/*Client.ts` module's reasoning (`lib/accountingClient.ts` et al.):
 * `services/reportingService.ts` imports server-only modules
 * (`lib/wixDataApi.ts`) and can never be imported into a Client
 * Component, so this file re-fetches the same data over HTTP instead.
 * Types are imported `type`-only from the server files — erased at build
 * time, never bundled.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

function toQueryString(organizationId: string, filters: ReportFilters = {}): string {
  const params = new URLSearchParams({ organizationId });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export async function fetchReportDefinitions(organizationId: string): Promise<ReportDefinition[]> {
  const response = await fetch(`/api/reports?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.reports as ReportDefinition[]) ?? [];
}

export async function runReport(organizationId: string, reportKey: string, filters: ReportFilters = {}): Promise<ReportRunResult> {
  const response = await fetch(`/api/reports/${encodeURIComponent(reportKey)}?${toQueryString(organizationId, filters)}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as ReportRunResult;
}

export function exportReportCsvUrl(organizationId: string, reportKey: string, filters: ReportFilters = {}): string {
  return `/api/reports/${encodeURIComponent(reportKey)}/export?${toQueryString(organizationId, filters)}`;
}

export async function fetchMetricValue(organizationId: string, metricKey: string, filters: ReportFilters = {}): Promise<{ metricKey: string; displayName: string; value: unknown }> {
  const response = await fetch(`/api/metrics/${encodeURIComponent(metricKey)}?${toQueryString(organizationId, filters)}`);
  return (await parseJsonOrThrow(response)) as unknown as { metricKey: string; displayName: string; value: unknown };
}

export async function fetchDashboard(organizationId: string): Promise<DashboardResult> {
  const response = await fetch(`/api/dashboard?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as DashboardResult;
}

export async function fetchReportPresets(organizationId: string, reportKey?: string): Promise<ReportPreset[]> {
  const params = new URLSearchParams({ organizationId });
  if (reportKey) params.set('reportKey', reportKey);
  const response = await fetch(`/api/report-presets?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return (body.presets as ReportPreset[]) ?? [];
}

export async function createReportPreset(params: { organizationId: string; reportKey: string; name: string; filters: string; isShared?: boolean }): Promise<ReportPreset> {
  const response = await fetch('/api/report-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrThrow(response);
  return body.preset as ReportPreset;
}

export async function deleteReportPreset(organizationId: string, presetId: string): Promise<void> {
  const response = await fetch(`/api/report-presets/${encodeURIComponent(presetId)}?organizationId=${encodeURIComponent(organizationId)}`, { method: 'DELETE' });
  await parseJsonOrThrow(response);
}

export type { ReportDefinition, ReportCategory, MetricDefinition, ReportRunResult, ReportFilters, DashboardResult, ReportPreset };
