import { useEffect, useMemo, useState } from 'react';
import { useOrganization } from './useOrganization';
import { useOrganizationRecord } from './useOrganizationRecord';
import { isSlaTrackingEnabled, resolveSlaSettings, type SlaSettings } from '@/domain/sla/slaSettings';

/**
 * SLA tracking (2026-10). The organization's SLA settings and a "now" that
 * advances every minute, so a deadline turns "Due today" → "Overdue" at
 * closing time without a reload. Undefined for an organization without SLA
 * tracking, which keeps every view model exactly as before.
 */
export function useSlaContext(): { settings: SlaSettings; nowIso: string } | undefined {
  const { organizationId } = useOrganization();
  const enabled = isSlaTrackingEnabled(organizationId);
  const organization = useOrganizationRecord();
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const record = organization.data;
  return useMemo(
    () => (enabled ? { settings: resolveSlaSettings(record ?? { id: organizationId }), nowIso } : undefined),
    [enabled, record, organizationId, nowIso],
  );
}
