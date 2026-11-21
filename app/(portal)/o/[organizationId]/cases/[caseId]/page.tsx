import { redirect } from 'next/navigation';
import { alignSessionOrganization } from '@/lib/auth/alignSessionOrganization';
import { OrganizationAccessDenied } from '@/components/portfolio/OrganizationAccessDenied';
import CaseDetailPage from '../../../../cases/[caseId]/page';

/**
 * Unified portal (Phase 5N, 2026-11): a case's address names its
 * organization — `/o/{organizationId}/cases/{caseId}` — because case
 * numbers (and, in principle, ids) are only unique within an organization.
 * The server confirms the person's own membership in that organization and
 * makes it the working organization before the case opens, so the case
 * runs on THAT organization's workflow, permissions, documents and rules,
 * and every write goes to it. `/cases/{caseId}` keeps working for the
 * organization already selected.
 */
export default async function OrganizationCasePage({ params }: { params: Promise<{ organizationId: string; caseId: string }> }) {
  const { organizationId, caseId } = await params;
  const result = await alignSessionOrganization(organizationId);
  if (result.status === 'unauthenticated') redirect('/login');
  if (result.status === 'mfa_enrollment_required') redirect('/mfa-setup');
  if (result.status === 'switched') redirect(`/o/${encodeURIComponent(organizationId)}/cases/${encodeURIComponent(caseId)}`);
  if (result.status === 'denied') return <OrganizationAccessDenied />;
  return <CaseDetailPage params={Promise.resolve({ caseId })} />;
}
