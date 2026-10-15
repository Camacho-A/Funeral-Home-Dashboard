import type { ReportPreset } from '../../types/reportPreset';
import { mockCollection } from './mockStore';

/** Phase 32 (Reporting, Analytics & Executive Dashboard). Starts empty,
    like every other net-new collection this codebase has introduced
    (`caseDocumentFixtures`, `signatureRequestFixtures`, `resourceFixtures`,
    etc.) — `services/reportPresetService.ts` is the sole writer. */
export const reportPresetFixtures: ReportPreset[] = mockCollection('reportPresetFixtures', (): ReportPreset[] => []);
