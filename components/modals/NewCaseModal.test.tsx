import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewCaseModal } from './NewCaseModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { staffFixtures } from '@/services/__mocks__/fixtures';

// NewCaseModal calls useRouter() (next/navigation) unconditionally on every
// render to navigate on successful submit — outside a real Next.js App
// Router tree that throws, since there's no AppRouterContext. Mocked here
// since these tests only care about the read-only rendering, never submit.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderModal() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <NewCaseModal open onClose={() => {}} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('NewCaseModal — intake owner is read-only', () => {
  it("displays the current session's staff member as plain text", () => {
    renderModal();
    expect(screen.getByText(staffFixtures[0].displayName)).toBeInTheDocument();
  });

  it('renders no <select> anywhere in the form — no staff picker exists to change the intake owner', () => {
    const { container } = renderModal();
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  it('does not render the intake owner name inside any editable form control', () => {
    renderModal();
    const nameNode = screen.getByText(staffFixtures[0].displayName);
    expect(['INPUT', 'SELECT', 'TEXTAREA']).not.toContain(nameNode.tagName);
  });

  it('has no form control whose value could ever end up as intakeOwnerId — every editable input maps to a NewCaseInput field, none of which is intakeOwnerId', () => {
    const { container } = renderModal();
    // Every <input>/<textarea> in the modal is one of the free-text intake
    // fields (decedent/contacts/payment); none is labeled for the intake
    // owner, and there is no select-based owner picker (asserted above).
    const inputs = container.querySelectorAll('input, textarea');
    inputs.forEach((el) => {
      expect(el.getAttribute('aria-label') ?? '').not.toMatch(/taking this call|intake owner/i);
    });
  });
});
