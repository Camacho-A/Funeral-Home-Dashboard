import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryAllWixDataItems } from '../lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '../lib/wixCaseMapper';
import { isOrganizationAllowedInDeployment } from '../lib/auth/deploymentOrganizations';
import { deploymentOrganizationWixFilter, retainDeploymentRecords } from './scheduledJobs/sweepSupport';
import { caseFixtures } from './__mocks__/fixtures';
import { getOrganization } from './organizationProvisioningService';
import { notifySlaAlert, type SlaAlertKind } from './caseNotifications';
import type { Case } from '../types/case';
import { isSlaTrackingEnabled, resolveSlaSettings, type SlaSettings } from '../domain/sla/slaSettings';
import {
  SLA_RESPONSIBLE_LABEL,
  describeDeadline,
  evaluateCaseSla,
  type SlaMilestoneEvaluation,
} from '../domain/sla/slaMilestones';
import { composeDecedentName } from '../domain/cases/decedentName';

/**
 * SLA alerts (2026-10). One sweep over this deployment's active cases,
 * using the same evaluation as the dashboard and the case header.
 *
 *   due               a STAFF milestone is due soon or due today
 *   overdue           a STAFF milestone has passed its deadline
 *   external_overdue  a doctor / state / crematory milestone is past target
 *
 * Never for the advisory family-pickup reminder, never for an archived
 * case, never when staff have already recorded a delay explaining it, and
 * never to anyone outside the organization (case.read recipients only).
 * Each (case, milestone, deadline, kind) notifies at most once — running
 * the sweep again never repeats an alert. Families, doctors and
 * crematories are never contacted.
 *
 * Triggered by POST /api/cron/sla-alerts (CRON_SECRET), like the other
 * scheduled jobs; see docs/SCHEDULED_JOBS.md for enabling a schedule.
 */

/** The alert a milestone warrants right now, if any. Pure. */
export function slaAlertFor(milestone: SlaMilestoneEvaluation, settings: SlaSettings): SlaAlertKind | null {
  if (milestone.state !== 'active' || milestone.advisory || milestone.delay) return null;
  if (milestone.external) {
    return milestone.overdue && settings.notifications.external ? 'external_overdue' : null;
  }
  if (milestone.status === 'overdue') return settings.notifications.overdue ? 'overdue' : null;
  if (milestone.status === 'due_soon' || milestone.status === 'due_today') return settings.notifications.approaching ? 'due' : null;
  // 'waiting_on_others' on a staff milestone is the family's wait (EDRS
  // without paperwork): not a staff failure, so no alert.
  return null;
}

async function listActiveCases(dataAdapterMode: DataAdapterMode): Promise<Case[]> {
  if (dataAdapterMode === 'mock') return caseFixtures.filter((c) => !c.isDeleted && isOrganizationAllowedInDeployment(c.organizationId));
  const items = await queryAllWixDataItems<WixCaseItem>('cases', { filter: { ...deploymentOrganizationWixFilter(), isDeleted: false } });
  const cases = items.map((item) => mapWixCaseItem(item.data)).filter((c): c is Case => c !== null && !c.isDeleted);
  return retainDeploymentRecords('sla-alerts', cases, (c) => c.organizationId);
}

export async function runSlaAlertSweep(nowIso: string, dataAdapterMode: DataAdapterMode): Promise<{ evaluated: number; notified: number }> {
  const cases = (await listActiveCases(dataAdapterMode)).filter((c) => isSlaTrackingEnabled(c.organizationId));
  const settingsByOrg = new Map<string, SlaSettings>();
  let notified = 0;

  for (const case_ of cases) {
    if (!isOrganizationAllowedInDeployment(case_.organizationId)) continue;
    let settings = settingsByOrg.get(case_.organizationId);
    if (!settings) {
      const organization = await getOrganization(case_.organizationId, dataAdapterMode);
      settings = resolveSlaSettings(organization ?? { id: case_.organizationId });
      settingsByOrg.set(case_.organizationId, settings);
    }
    const current = evaluateCaseSla(case_, settings, nowIso).current;
    const kind = current ? slaAlertFor(current, settings) : null;
    if (!current || !kind || !current.deadline) continue;

    const result = await notifySlaAlert(
      { organizationId: case_.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: crypto.randomUUID(), isSystemGenerated: true },
      {
        case: { id: case_.id, caseNumber: case_.caseNumber, decedentName: composeDecedentName(case_.decedentName, case_.decedentMiddleName) },
        kind,
        milestoneKey: `${current.key}-${kind}`,
        milestone: current.label,
        deadline: current.deadline,
        dueLabel: describeDeadline(current),
        party: SLA_RESPONSIBLE_LABEL[current.responsibleParty],
      },
      dataAdapterMode,
    );
    notified += result.notified;
  }
  return { evaluated: cases.length, notified };
}
