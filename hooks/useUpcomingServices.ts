import { useQuery } from '@tanstack/react-query';
import type { UpcomingServiceSummary } from '@/services/upcomingServicesService';

/** Upcoming services with preparation progress (Gus Phase 5L). */
export function useUpcomingServices(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['upcomingServices', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async (): Promise<UpcomingServiceSummary[]> => {
      const response = await fetch(`/api/service-preparation/upcoming?${new URLSearchParams({ organizationId })}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not load upcoming services.');
      return body.services as UpcomingServiceSummary[];
    },
  });
}
