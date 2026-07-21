import { Checkbox } from '@/components/ui/Checkbox';
import { SelectField } from '@/components/ui/SelectField';
import type { PaymentStatus, VaPublishChoice } from '@/types/case';
import type { VaStepViewModel } from '@/types/caseViewModel';
import { VaNotificationPanel } from './VaNotificationPanel';
import styles from './CaseInformationCard.module.css';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in full',
  awaiting_payment: 'Awaiting payment',
};

export type StaffOption = { id: string; name: string };

export function CaseInformationCard({
  dateOfBirth,
  dateOfDeath,
  timeOfDeath,
  placeOfDeath,
  weight,
  weightOver200,
  nextOfKinName,
  nextOfKinPhone,
  paymentStatus,
  ownerStaffId,
  staffOptions,
  onReassignOwner,
  isVeteran,
  veteranFlagLocked,
  onToggleVeteran,
  vaSteps,
  vaCallbackDone,
  vaPublishChoice,
  onToggleVaStep,
  onSetVaPublishChoice,
}: {
  dateOfBirth: string;
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string;
  weightOver200: boolean;
  nextOfKinName: string;
  nextOfKinPhone: string;
  paymentStatus: PaymentStatus;
  ownerStaffId: string | null;
  staffOptions: StaffOption[];
  onReassignOwner: (staffId: string) => void;
  isVeteran: boolean;
  veteranFlagLocked: boolean;
  onToggleVeteran: (newValue: boolean) => void;
  vaSteps: VaStepViewModel[];
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  onToggleVaStep: (index: number, newDone: boolean) => void;
  onSetVaPublishChoice: (choice: VaPublishChoice) => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>Case information</div>
      <div className={styles.grid}>
        <div>
          <div className={styles.fieldLabel}>Date of birth</div>
          <div className={styles.fieldValue}>{dateOfBirth}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Date of death</div>
          <div className={styles.fieldValue}>{dateOfDeath}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Time of death</div>
          <div className={styles.fieldValue}>{timeOfDeath}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Location</div>
          <div className={styles.fieldValue}>{placeOfDeath}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Weight</div>
          <div className={`${styles.weightValue} ${weightOver200 ? styles.weightOver : styles.weightNormal}`}>
            {weight}
            {weightOver200 && <span className={styles.notifyBadge}>Notify crematory</span>}
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Next of kin</div>
          <div className={styles.fieldValue}>{nextOfKinName}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>NOK phone</div>
          <div className={styles.fieldValue}>{nextOfKinPhone}</div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Payment</div>
          <div
            className={`${styles.fieldValue} ${paymentStatus === 'paid_in_full' ? styles.paymentSuccess : styles.paymentPending}`}
          >
            {PAYMENT_STATUS_LABEL[paymentStatus]}
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Owner</div>
          <SelectField
            className={styles.ownerSelect}
            value={ownerStaffId ?? ''}
            onChange={(e) => onReassignOwner(e.target.value)}
          >
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div
        className={`${styles.veteranRow} ${veteranFlagLocked ? styles.veteranRowLocked : styles.veteranRowUnlocked}`}
        onClick={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
      >
        <Checkbox
          checked={isVeteran}
          disabled={veteranFlagLocked}
          onChange={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
          tone="brand"
          aria-label="Served in the armed forces"
        />
        <span className={styles.veteranLabel}>Served in the armed forces</span>
        {veteranFlagLocked && <span className={styles.veteranLockedNote}>editable during First Call &amp; Payment only</span>}
      </div>

      {isVeteran && (
        <VaNotificationPanel
          vaSteps={vaSteps}
          vaCallbackDone={vaCallbackDone}
          vaPublishChoice={vaPublishChoice}
          onToggleStep={onToggleVaStep}
          onSetPublishChoice={onSetVaPublishChoice}
        />
      )}
    </div>
  );
}
