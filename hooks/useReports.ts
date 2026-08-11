import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportFilters } from '@/services/reportingService';
import {
  fetchReportDefinitions,
  runReport,
  fetchMetricValue,
  fetchReportPresets,
  createReportPreset,
  deleteReportPreset,
} from '@/lib/reportsClient';

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Query/mutation
 * hooks for the Reports Library and Report Viewer — bundled in one file,
 * matching `hooks/useAccounting.ts`/`hooks/useRbac.ts`'s own convention.
 */

const reportDefinitionsKey = (organizationId: string) => ['reports', 'definitions', organizationId];
const reportRunKey = (organizationId: string, reportKey: string, filters: ReportFilters) => ['reports', 'run', organizationId, reportKey, filters];
const metricKey = (organizationId: string, metric: string, filters: ReportFilters) => ['reports', 'metric', organizationId, metric, filters];
const reportPresetsKey = (organizationId: string, reportKey?: string) => ['reports', 'presets', organizationId, reportKey ?? null];

export function useReportDefinitions(organizationId: string) {
  return useQuery({ queryKey: reportDefinitionsKey(organizationId), queryFn: () => fetchReportDefinitions(organizationId), enabled: Boolean(organizationId) });
}

export function useReportRun(organizationId: string, reportKey: string | null, filters: ReportFilters = {}) {
  return useQuery({
    queryKey: reportRunKey(organizationId, reportKey ?? '', filters),
    queryFn: () => runReport(organizationId, reportKey!, filters),
    enabled: Boolean(organizationId) && Boolean(reportKey),
  });
}

export function useMetricValue(organizationId: string, metric: string | null, filters: ReportFilters = {}) {
  return useQuery({
    queryKey: metricKey(organizationId, metric ?? '', filters),
    queryFn: () => fetchMetricValue(organizationId, metric!, filters),
    enabled: Boolean(organizationId) && Boolean(metric),
  });
}

export function useReportPresets(organizationId: string, reportKey?: string) {
  return useQuery({ queryKey: reportPresetsKey(organizationId, reportKey), queryFn: () => fetchReportPresets(organizationId, reportKey), enabled: Boolean(organizationId) });
}

export function useCreateReportPreset(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { reportKey: string; name: string; filters: string; isShared?: boolean }) => createReportPreset({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports', 'presets', organizationId] }),
  });
}

export function useDeleteReportPreset(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) => deleteReportPreset(organizationId, presetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports', 'presets', organizationId] }),
  });
}
