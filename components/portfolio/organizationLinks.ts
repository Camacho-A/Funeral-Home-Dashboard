/** Unified portal (Phase 5N): a case's address always names its organization. */
export function organizationCaseHref(organizationId: string, caseId: string): string {
  return `/o/${encodeURIComponent(organizationId)}/cases/${encodeURIComponent(caseId)}`;
}
