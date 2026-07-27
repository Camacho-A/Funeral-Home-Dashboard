import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingClient } from '@/services/onboardingClient';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Deliberately
 * does not use useOrganization() anywhere — onboarding operates on an
 * onboardingSessionId, never an organizationId, and runs both before an
 * organization is fully set up and (for a platform administrator)
 * entirely outside the single-tenant OrganizationProvider default this
 * app otherwise assumes.
 */

export function useOnboardingSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['onboardingSession', sessionId],
    queryFn: () => onboardingClient.getSession(sessionId),
  });
}

function useStepMutation<Input, Result extends { onboardingSession: unknown }>(
  fn: (input: Input) => Promise<Result>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      const sessionId = (result.onboardingSession as { id?: string } | null)?.id;
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['onboardingSession', sessionId] });
      }
    },
  });
}

export function useStartOnboarding() {
  return useMutation({ mutationFn: onboardingClient.start });
}

export function useSaveOrganizationProfile() {
  return useStepMutation(onboardingClient.saveOrganizationProfile);
}

export function useSavePrimaryLocation() {
  return useStepMutation(onboardingClient.savePrimaryLocation);
}

export function useSaveAdministrator() {
  return useStepMutation(onboardingClient.saveAdministrator);
}

export function useSaveWorkflow() {
  return useStepMutation(onboardingClient.saveWorkflow);
}

export function useSaveIntake() {
  return useStepMutation((sessionId: string) => onboardingClient.saveIntake(sessionId));
}

export function useSaveServices() {
  return useStepMutation((sessionId: string) => onboardingClient.saveServices(sessionId));
}

export function useSavePayments() {
  return useStepMutation(onboardingClient.savePayments);
}

export function useSaveBranding() {
  return useStepMutation(onboardingClient.saveBranding);
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => onboardingClient.complete(sessionId),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['onboardingSession', sessionId] });
    },
  });
}
