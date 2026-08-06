import type { ActivityEventCategory, ActivitySeverity } from '@/types/activityEvent';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). Which ActivitySeverity
 * maps to which Badge variant/label — a domain decision, kept out of
 * components/case/CaseActivityTab.tsx and components/settings/ActivityEventList.tsx
 * per Badge's own convention (see components/ui/Badge.tsx's comment) that a
 * UI primitive never decides what a business condition means. Matches
 * domain/cases/paymentDisplay.ts's shape for the same kind of decision.
 */
export const ACTIVITY_SEVERITY_LABEL: Record<ActivitySeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export function activitySeverityVariant(severity: ActivitySeverity): BadgeVariant {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'brand';
  return 'neutral';
}

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityEventCategory, string> = {
  authentication: 'Authentication',
  team_management: 'Team',
  cases: 'Cases',
  payments: 'Payments',
  documents: 'Documents',
  workflow: 'Workflow',
  scheduling: 'Scheduling',
  inventory: 'Inventory',
  notifications: 'Notifications',
  administration: 'Administration',
  family_portal: 'Family Portal',
  system: 'System',
};
