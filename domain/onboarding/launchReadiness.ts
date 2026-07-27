/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Pure launch-
 * readiness calculation — takes booleans the caller has already resolved
 * from real provisioning state (never just "did the client claim this
 * step was done"), so a forged `completedSteps` array can never make
 * `completeOnboarding()` succeed without the underlying records actually
 * existing. See services/organizationProvisioningService.ts's
 * `validateLaunchReadiness`, the one caller that resolves these booleans
 * from real `organizations`/`organizationLocations`/`organizationMemberships`/
 * `workflowTemplates`/`serviceCatalog`/`paymentIntegrations`/
 * `organizationBranding` state before calling this function.
 */
export type LaunchReadinessInput = {
  hasOrganizationProfile: boolean;
  hasPrimaryLocation: boolean;
  hasAdministrator: boolean;
  hasWorkflow: boolean;
  hasIntakeConfigured: boolean;
  hasServiceCatalog: boolean;
  /** Not "is Clover enabled" — "has staff been shown and acknowledged the
      payments step" (see this phase's own "Payment integration does not
      need to be enabled to launch" requirement). */
  paymentStatusReviewed: boolean;
  brandingReviewed: boolean;
};

export type LaunchChecklistItem = {
  key: string;
  label: string;
  satisfied: boolean;
};

export function buildLaunchChecklist(input: LaunchReadinessInput): LaunchChecklistItem[] {
  return [
    { key: 'organization_profile', label: 'Organization profile complete', satisfied: input.hasOrganizationProfile },
    { key: 'primary_location', label: 'Primary location created', satisfied: input.hasPrimaryLocation },
    { key: 'administrator', label: 'Administrator assigned', satisfied: input.hasAdministrator },
    { key: 'workflow', label: 'Workflow created', satisfied: input.hasWorkflow },
    { key: 'intake', label: 'Intake configured', satisfied: input.hasIntakeConfigured },
    { key: 'service_catalog', label: 'Service catalog seeded', satisfied: input.hasServiceCatalog },
    { key: 'payments', label: 'Payment status reviewed', satisfied: input.paymentStatusReviewed },
    { key: 'branding', label: 'Branding reviewed', satisfied: input.brandingReviewed },
  ];
}

export function isReadyToLaunch(input: LaunchReadinessInput): boolean {
  return buildLaunchChecklist(input).every((item) => item.satisfied);
}

/** The exact two labels this phase's own spec requires the launch screen
    to be able to show — never a third ambiguous state. */
export function cloverReadinessLabel(cloverConfigured: boolean): 'Clover ready' | 'Clover not configured' {
  return cloverConfigured ? 'Clover ready' : 'Clover not configured';
}
