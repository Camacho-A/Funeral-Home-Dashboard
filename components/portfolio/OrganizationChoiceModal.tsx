'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useMyPermissions } from '@/hooks/useRbac';
import { usePortfolio, type PortfolioOrganization } from '@/hooks/usePortfolio';
import { organizationAcceptsNewCases } from '@/domain/organization/organizationTransition';
import { switchOrganization } from '@/lib/identityAuthClient';

/**
 * Unified portal (Phase 5N, 2026-11). A new case always belongs to ONE
 * organization, chosen explicitly — never the combined view. Lists the
 * organizations the person belongs to; an organization is offered only if
 * it accepts new cases (not historical) and the person may create cases
 * THERE (their role in that organization). The server re-checks all of it.
 * Choosing another organization makes it the working organization first,
 * so the case is numbered by that organization's own rules.
 */
export function OrganizationChoiceModal({ open, onClose, onChosen }: { open: boolean; onClose: () => void; onChosen: (organizationId: string) => void }) {
  const { organizations, workingOrganizationId } = usePortfolio();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function choose(org: PortfolioOrganization) {
    setError(null);
    if (org.organizationId === workingOrganizationId) {
      onChosen(org.organizationId);
      return;
    }
    setPending(org.organizationId);
    try {
      await switchOrganization(org.organizationId);
      // A full reload re-resolves the working organization on the server, then opens New Case there.
      window.location.assign(`/dashboard?newCase=1`);
    } catch {
      setError('Could not switch organization. Nothing was created.');
      setPending(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New case — choose the funeral home">
      <div data-testid="organization-choice">
        <p style={{ margin: '0 0 12px' }}>Which funeral home is this case for? It is numbered and handled under that funeral home&rsquo;s own rules.</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {organizations.map((org) => (
            <OrganizationChoice key={org.organizationId} org={org} pending={pending === org.organizationId} disabled={pending !== null} onChoose={() => void choose(org)} />
          ))}
        </ul>
        {error && (
          <p role="alert" className="sx-form-banner sx-form-banner-error" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function OrganizationChoice({ org, pending, disabled, onChoose }: { org: PortfolioOrganization; pending: boolean; disabled: boolean; onChoose: () => void }) {
  const permissions = useMyPermissions(org.organizationId);
  const canCreate = permissions.data?.permissions.includes('case.create') ?? false;
  const historical = !organizationAcceptsNewCases(org.organizationId);
  const reason = historical ? 'Historical — new cases can no longer be opened.' : !permissions.isLoading && !canCreate ? 'Your role here cannot create cases.' : null;
  return (
    <li>
      <button
        type="button"
        className="sx-btn sx-btn-secondary"
        style={{ width: '100%', justifyContent: 'space-between', display: 'flex', textAlign: 'left', gap: 12, minHeight: 44 }}
        disabled={disabled || historical || !canCreate}
        onClick={onChoose}
        data-testid={`choose-${org.organizationId}`}
      >
        <span>{org.displayName}</span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{pending ? 'Switching…' : reason ?? ''}</span>
      </button>
    </li>
  );
}
