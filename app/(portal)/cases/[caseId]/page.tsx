/**
 * Placeholder — built out in Phase 6 (Frontend Engineering Plan).
 *
 * Reads the route param and narrows it to a plain `caseId: string` here —
 * this is the only place in the app allowed to do that (Project
 * Architecture, "Route/feature decoupling"). Once real content exists, this
 * caseId is what gets passed into hooks/components below the page level;
 * nothing downstream ever reads params directly.
 */
export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  return <p>Case Detail for case {caseId} — built in Phase 6.</p>;
}
