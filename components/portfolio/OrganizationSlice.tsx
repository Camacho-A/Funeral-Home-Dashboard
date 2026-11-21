'use client';

import { useEffect, useMemo } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useStageBreakdownRows } from '@/hooks/useStageBreakdownRows';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationActivity } from '@/hooks/useActivity';
import { useUpcomingServices } from '@/hooks/useUpcomingServices';
import { useOrganization } from '@/hooks/useOrganization';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import type { StageBarRow } from '@/components/dashboard/CasesByStagePanel';

export type CombinedCaseRow = { organizationId: string; caseId: string; caseNumber: string; decedentName: string; detail: string; sortKey: string };
export type OrganizationSliceData = {
  organizationId: string;
  loaded: boolean;
  attention: CombinedCaseRow[];
  recent: CombinedCaseRow[] | null; // null: this person may not read this organization's activity
  upcoming: CombinedCaseRow[];
  stages: { rows: StageBarRow[]; total: number | null };
};

const ACTIVITY_FILTERS = { excludeCategory: 'notifications' } as const;

/**
 * Unified portal (Phase 5N). Rendered INSIDE an OrganizationProvider for one
 * organization, so every hook below — cases, staff, SLA, stages, workflow
 * templates, permissions, activity, upcoming services — asks the server
 * about that organization only, with the person's role THERE, and applies
 * that organization's own rules (its stage model, its service preparation).
 * Renders nothing; reports its organization's part of the combined
 * Dashboard upward.
 */
export function OrganizationSlice({ onData }: { onData: (data: OrganizationSliceData) => void }) {
  const { organizationId } = useOrganization();
  const casesQuery = useCases();
  const viewModels = useCaseViewModels(casesQuery.data);
  const stages = useStageBreakdownRows();
  const permissions = useMyPermissions(organizationId);
  const canReadAudit = (permissions.data?.permissions ?? []).includes('audit.read');
  const activity = useOrganizationActivity(organizationId, ACTIVITY_FILTERS, canReadAudit);
  const hasServices = getRegisteredOrganizationProfile(organizationId).features.servicePreparation;
  const upcomingQuery = useUpcomingServices(organizationId, hasServices);

  const data = useMemo<OrganizationSliceData>(() => {
    const caseById = new Map((casesQuery.data ?? []).map((c) => [c.id, c]));
    const attention = viewModels
      .filter((c) => c.needsAttention)
      .map((c) => ({ organizationId, caseId: c.id, caseNumber: c.caseNumber, decedentName: c.decedentName, detail: c.attentionReason, sortKey: String(1000 - Math.min(999, c.daysWaitingInStage)).padStart(4, '0') }));
    let recent: CombinedCaseRow[] | null = null;
    if (canReadAudit) {
      const seen = new Set<string>();
      recent = [];
      for (const event of (activity.data?.pages ?? []).flatMap((p) => p.events)) {
        if (!event.caseId || seen.has(event.caseId)) continue;
        const c = caseById.get(event.caseId);
        if (!c) continue;
        seen.add(event.caseId);
        recent.push({ organizationId, caseId: c.id, caseNumber: c.caseNumber, decedentName: c.decedentName, detail: event.createdAt, sortKey: event.createdAt });
        if (recent.length >= 8) break;
      }
    }
    const upcoming = (upcomingQuery.data ?? []).map((s) => ({
      organizationId,
      caseId: s.caseId,
      caseNumber: s.caseNumber,
      decedentName: s.decedentName,
      detail: `${s.serviceName} — ${s.completed}/${s.total} ready`,
      sortKey: s.startAt,
    }));
    return { organizationId, loaded: casesQuery.isSuccess, attention, recent, upcoming, stages };
  }, [organizationId, casesQuery.data, casesQuery.isSuccess, viewModels, canReadAudit, activity.data, upcomingQuery.data, stages]);

  useEffect(() => onData(data), [data, onData]);
  return null;
}
