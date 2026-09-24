import { UnmatchedFormsPanel } from '@/components/externalForms/UnmatchedFormsPanel';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). NOT a
 * general intake queue — never creates a case. See
 * components/externalForms/UnmatchedFormsPanel.tsx.
 */
export default function UnmatchedFormsPage() {
  return (
    <div>
      <h1>Unmatched Forms</h1>
      <UnmatchedFormsPanel />
    </div>
  );
}
