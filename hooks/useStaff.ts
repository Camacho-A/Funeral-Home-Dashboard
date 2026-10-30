import { useQuery } from '@tanstack/react-query';
import * as staffProfileService from '@/services/staffProfileService';
import type { StaffProfile } from '@/types/staffProfile';
import { useOrganization } from './useOrganization';

/**
 * The organization's active staff. Mock mode reads the fixtures directly,
 * as before; real data comes from `/api/staff/profiles` (2026-10) — the
 * staff profile service's Wix query needs server credentials, so calling
 * it from the browser failed and every assignee fell back to "Office".
 */
async function fetchStaffProfiles(organizationId: string): Promise<StaffProfile[]> {
  const response = await fetch(`/api/staff/profiles?organizationId=${encodeURIComponent(organizationId)}`);
  if (!response.ok) throw new Error('Failed to load staff.');
  const body = (await response.json()) as { staff: StaffProfile[] };
  return body.staff;
}

export function useStaff() {
  const organization = useOrganization();
  return useQuery({
    queryKey: ['staff', organization.organizationId],
    queryFn: () =>
      organization.dataAdapterMode === 'mock'
        ? staffProfileService.list(organization.organizationId, organization.dataAdapterMode)
        : fetchStaffProfiles(organization.organizationId),
  });
}
