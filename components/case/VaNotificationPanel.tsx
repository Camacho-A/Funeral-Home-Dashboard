import { Checkbox } from '@/components/ui/Checkbox';
import type { VaStepViewModel } from '@/types/caseViewModel';
import type { VaPublishChoice, VaNotificationResponsibility } from '@/types/case';
import { useOrganization } from '@/hooks/useOrganization';
import {
  getOrganizationProfile,
  VA_FUNERAL_HOME_RESPONSIBILITY_KEY,
  vaNotificationFuneralHomeLabel,
  vaNotificationStaffPhrase,
} from '@/domain/organization/organizationProfiles';
import styles from './VaNotificationPanel.module.css';

/**
 * Shown inside CaseInformationCard when a case is flagged as a veteran.
 * `vaCallbackDone` (step index 1) gates whether the publish/private choice
 * appears, matching design/support.js's isVaCallbackDone exactly.
 *
 * VA responsibility correction (2026-09): "did the decedent serve" and
 * "who is handling VA notification" are independent facts — see
 * types/case.ts's own comment. The MANORS/FAMILY choice below is answered
 * FIRST; the internal VA_STEPS checklist only renders once MANORS is
 * selected (Manors staff are on the hook), never for FAMILY (not
 * applicable — nothing for staff to do) and never while undecided (`null`
 * — "fail safely," never assumed to be either answer). See
 * domain/cases/veteran.ts#isVaComplete, which mirrors this exact
 * three-way branch for the "needs attention" calculation.
 *
 * Multi-tenant (2026-10): the stored value stays `'manors'` — the legacy
 * key for "this funeral home is handling it", never rewritten — but the
 * button label and the family note come from the current organization's
 * profile (domain/organization/organizationProfiles.ts): "MANORS" for
 * Manors exactly as before, the organization's own short name otherwise.
 */
export function VaNotificationPanel({
  vaSteps,
  vaCallbackDone,
  vaPublishChoice,
  vaNotificationResponsibility,
  onToggleStep,
  onSetPublishChoice,
  onSetVaNotificationResponsibility,
  organizationId: organizationIdProp,
  organizationName,
}: {
  vaSteps: VaStepViewModel[];
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  vaNotificationResponsibility: VaNotificationResponsibility | null;
  onToggleStep: (index: number, newDone: boolean) => void;
  onSetPublishChoice: (choice: VaPublishChoice) => void;
  onSetVaNotificationResponsibility: (responsibility: VaNotificationResponsibility) => void;
  /** Defaults to the current organization (useOrganization()). */
  organizationId?: string;
  /** Organization record name, when the caller has it — used only for an
      organization with no registered profile name. */
  organizationName?: string | null;
}) {
  const { organizationId: contextOrganizationId } = useOrganization();
  const profile = getOrganizationProfile(organizationIdProp ?? contextOrganizationId);
  const nameSource = organizationName && !profile.registered ? { ...profile, displayName: organizationName } : profile;
  const funeralHomeLabel = vaNotificationFuneralHomeLabel(nameSource);
  const staffPhrase = vaNotificationStaffPhrase(nameSource);
  return (
    <div className={styles.panel}>
      <div className={styles.title}>VA notification</div>

      <div className={styles.publishPrompt}>Who is handling the VA notification?</div>
      <div className={styles.publishButtons}>
        <button
          type="button"
          className={`${styles.publishButton} ${vaNotificationResponsibility === VA_FUNERAL_HOME_RESPONSIBILITY_KEY ? styles.publishButtonActive : styles.publishButtonInactive}`}
          onClick={() => onSetVaNotificationResponsibility(VA_FUNERAL_HOME_RESPONSIBILITY_KEY)}
        >
          {funeralHomeLabel}
        </button>
        <button
          type="button"
          className={`${styles.publishButton} ${vaNotificationResponsibility === 'family' ? styles.publishButtonActive : styles.publishButtonInactive}`}
          onClick={() => onSetVaNotificationResponsibility('family')}
        >
          FAMILY
        </button>
      </div>

      {vaNotificationResponsibility === 'family' && (
        <p className={styles.familyNote}>
          Family is handling VA notification — no action needed from {staffPhrase}.
        </p>
      )}

      {vaNotificationResponsibility === VA_FUNERAL_HOME_RESPONSIBILITY_KEY && (
        <div className={styles.stepsSection}>
          {vaSteps.map((step) => (
            <div
              key={step.index}
              className={`${styles.step} ${!step.locked ? styles.stepClickable : ''}`}
              onClick={step.locked ? undefined : () => onToggleStep(step.index, !step.done)}
            >
              <Checkbox
                checked={step.done}
                disabled={step.locked}
                onChange={step.locked ? undefined : () => onToggleStep(step.index, !step.done)}
                tone={step.done ? 'success' : 'brand'}
                size="sm"
                aria-label={step.label}
              />
              <span className={`${styles.stepLabel} ${step.locked ? styles.stepLabelLocked : styles.stepLabelActive}`}>
                {step.label}
              </span>
            </div>
          ))}

          {vaCallbackDone && (
            <div className={styles.publishSection}>
              <div className={styles.publishPrompt}>Publish the service, or keep it private?</div>
              <div className={styles.publishButtons}>
                <button
                  type="button"
                  className={`${styles.publishButton} ${vaPublishChoice === 'publish' ? styles.publishButtonActive : styles.publishButtonInactive}`}
                  onClick={() => onSetPublishChoice('publish')}
                >
                  Publish
                </button>
                <button
                  type="button"
                  className={`${styles.publishButton} ${vaPublishChoice === 'private' ? styles.publishButtonActive : styles.publishButtonInactive}`}
                  onClick={() => onSetPublishChoice('private')}
                >
                  Keep private
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
