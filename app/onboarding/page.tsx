'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOnboardingSession } from '@/hooks/useOnboarding';
import { OnboardingStepList } from '@/components/onboarding/OnboardingStepList';
import { OrganizationProfileStep } from '@/components/onboarding/OrganizationProfileStep';
import { PrimaryLocationStep } from '@/components/onboarding/PrimaryLocationStep';
import { AdministratorStep } from '@/components/onboarding/AdministratorStep';
import { WorkflowStep } from '@/components/onboarding/WorkflowStep';
import { IntakeStep } from '@/components/onboarding/IntakeStep';
import { ServicesStep } from '@/components/onboarding/ServicesStep';
import { PaymentsStep } from '@/components/onboarding/PaymentsStep';
import { BrandingStep } from '@/components/onboarding/BrandingStep';
import { ReviewLaunchStep } from '@/components/onboarding/ReviewLaunchStep';
import type { OnboardingStepKey } from '@/types/onboarding';
import styles from './page.module.css';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). A standalone
 * top-level route — outside `(portal)` — since it operates before an
 * organization-scoped session exists for most of the flow, matching
 * `/login`'s own precedent (not wrapped by AppShell/Sidebar). The
 * `sessionId` query param IS the resume mechanism: "exit and resume"
 * needs nothing beyond bookmarking (or being handed back) this URL — see
 * app/api/onboarding/session/route.ts's own fallback for a caller who
 * doesn't have it handy.
 *
 * Backward navigation never loses completed data: `OnboardingStepList`
 * lets staff click back into any already-completed step, and every step
 * component prefills from the current server state before rendering.
 */
function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const { data, isPending } = useOnboardingSession(sessionId);
  const [viewingStep, setViewingStep] = useState<OnboardingStepKey | null>(null);

  if (!sessionId) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.title}>New Organization</div>
        </div>
        <div className={styles.startCard}>
          <OrganizationProfileStep
            onboardingSessionId={null}
            organization={null}
            onStarted={(result) => router.push(`/onboarding?sessionId=${result.onboardingSession.id}`)}
            onSaved={() => {}}
          />
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  const onboardingSession = data?.onboardingSession ?? null;
  if (!onboardingSession) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Onboarding session not found.</p>
      </div>
    );
  }

  const activeStep = viewingStep ?? onboardingSession.currentStep;

  function afterSave() {
    setViewingStep(null); // return to whatever the server now reports as currentStep
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>{data?.organization?.name ?? 'Organization Onboarding'}</div>
        <div className={styles.resumeNotice}>Your progress is saved automatically. Bookmark this page to exit and resume later.</div>
      </div>

      <div className={styles.layout}>
        <OnboardingStepList
          currentStep={onboardingSession.currentStep}
          completedSteps={onboardingSession.completedSteps}
          onSelectStep={setViewingStep}
        />

        <div className={styles.card}>
          {activeStep === 'organization_profile' && (
            <OrganizationProfileStep
              onboardingSessionId={onboardingSession.id}
              organization={data?.organization ?? null}
              onStarted={() => {}}
              onSaved={afterSave}
            />
          )}
          {activeStep === 'primary_location' && (
            <PrimaryLocationStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'administrator_account' && (
            <AdministratorStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'workflow_setup' && (
            <WorkflowStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'intake_setup' && (
            <IntakeStep
              onboardingSessionId={onboardingSession.id}
              intake={data?.workflowTemplate?.versions[data.workflowTemplate.versions.length - 1]?.intake ?? null}
              onSaved={afterSave}
            />
          )}
          {activeStep === 'services_pricing' && (
            <ServicesStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'payments' && (
            <PaymentsStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'branding' && (
            <BrandingStep onboardingSessionId={onboardingSession.id} onSaved={afterSave} />
          )}
          {activeStep === 'review_launch' && (
            <ReviewLaunchStep
              onboardingSessionId={onboardingSession.id}
              organization={data?.organization ?? null}
              checklist={data?.checklist ?? []}
              ready={data?.ready ?? false}
              onLaunched={afterSave}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className={styles.page}><p className={styles.loading}>Loading…</p></div>}>
      <OnboardingPageInner />
    </Suspense>
  );
}
