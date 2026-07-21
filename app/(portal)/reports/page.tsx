'use client';

import { useMemo } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCaseViewModels } from '@/hooks/useCaseViewModels';
import { useStaff } from '@/hooks/useStaff';
import {
  computeKpis,
  computeStageBreakdown,
  computeStaffWorkload,
  computeVeteranCaseStatuses,
} from '@/domain/reports/calculations';
import { SelectField } from '@/components/ui/SelectField';
import { KpiTile } from '@/components/reports/KpiTile';
import { TimeInStagePanel } from '@/components/reports/TimeInStagePanel';
import { StaffWorkloadPanel } from '@/components/reports/StaffWorkloadPanel';
import { VeteranCasesPanel } from '@/components/reports/VeteranCasesPanel';
import styles from './page.module.css';

/**
 * Reports page (Frontend Engineering Plan, Phase 8) — the orchestration
 * layer. Calls domain/reports/calculations.ts directly via useMemo, the
 * same pattern the Dashboard (Phase 5) already established, rather than
 * through an intermediate useReports() hook — that hook was never actually
 * built in Phase 5, so this follows the pattern that's actually in the
 * codebase rather than the plan's original, superseded mention of it.
 */
export default function ReportsPage() {
  const { data: cases } = useCases();
  const { data: staffList = [] } = useStaff();
  const viewModels = useCaseViewModels(cases);

  const kpis = useMemo(() => computeKpis(viewModels), [viewModels]);
  const stageBreakdown = useMemo(() => computeStageBreakdown(viewModels), [viewModels]);
  const staffWorkload = useMemo(
    () => computeStaffWorkload(viewModels, staffList),
    [viewModels, staffList],
  );
  const veteranCases = useMemo(() => computeVeteranCaseStatuses(viewModels), [viewModels]);

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
        <SelectField className={styles.orgSelect} disabled defaultValue="Manor Cremation">
          <option>Manor Cremation</option>
          <option disabled>Gus Camacho Funeral Home — coming soon</option>
        </SelectField>
      </div>

      <div className={styles.kpiGrid}>
        <KpiTile value={kpis.activeCases} label="Active cases" />
        <KpiTile value={kpis.completedCases} label="Completed" />
        <KpiTile value={kpis.overdueCases} label="Overdue on SLA" variant="danger" />
        <KpiTile value={kpis.totalCases} label="Total cases on file" />
      </div>

      <div className={styles.middleGrid}>
        <TimeInStagePanel rows={stageBreakdown} />
        <StaffWorkloadPanel rows={staffWorkload} />
      </div>

      <VeteranCasesPanel rows={veteranCases} />
    </div>
  );
}
