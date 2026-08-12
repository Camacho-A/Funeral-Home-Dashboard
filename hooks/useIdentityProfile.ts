import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyIdentityProfile, updateMyPhone } from '@/lib/identityProfileClient';

/**
 * Phase 33 (Real Notification Delivery). Query/mutation hooks for the
 * caller's own `Identity` profile (currently: `phone`, the gate for the
 * SMS notification channel) — mirrors `hooks/useNotifications.ts`'s exact
 * shape. `Identity` is a Phase 21, `AUTH_ADAPTER='identity'`-only concept
 * — `fetchMyIdentityProfile` resolves to `null` under `'mock'`/`'wix'`
 * sessions (expected, not an error) rather than throwing, so callers can
 * render around it (e.g. hide the phone field, or show it disabled).
 */
const profileKey = (organizationId: string) => ['myIdentityProfile', organizationId];

export function useMyIdentityProfile(organizationId: string) {
  return useQuery({
    queryKey: profileKey(organizationId),
    queryFn: () => fetchMyIdentityProfile(organizationId),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateMyPhone(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phone: string | null) => updateMyPhone(organizationId, phone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKey(organizationId) }),
  });
}
