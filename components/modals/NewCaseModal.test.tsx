import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewCaseModal } from './NewCaseModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';
import { staffFixtures, caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { createCaseLogEntry } from '@/lib/caseLogClient';
import { resolveChecklist } from '@/domain/workflow/resolveChecklist';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The "Services &
 * Charges" section (ServicesAndChargesSelector) always renders these five
 * <input> elements once the service catalog fetch resolves — 3 weight
 * radios (under_200 always, plus 201_250/251_300 found in the catalog) and
 * 2 addon checkboxes (Mail Cremated Remains, Extra Death Certificate). The
 * quantity <input type="number"> only appears once a quantity is > 0, so
 * it's never part of this fixed count. Every fixed input-count assertion
 * below that predates this phase now adds this constant.
 */
// Manors launch-prep: addon controls (Additional Death Certificate/Keepsake
// Transfer steppers, Mail Cremated Remains/Urn Transfer/Shipping Add
// buttons) are all <button> elements now, not <input> — only the 3 weight
// tier radios remain literal <input>s (was 5: 3 radios + 2 addon
// checkboxes, before ServicesAndChargesSelector.tsx's rewrite). +1 again
// for the fixed "Next of kin — email" input (Manors launch-prep) — always
// rendered once templatesLoaded, independent of the org's own template.
const SERVICES_AND_CHARGES_INPUT_COUNT = 4;

// A stable, shared mock so tests can assert on navigation — useRouter() is
// called on every render (React hook rules), so an inline `() => vi.fn()`
// factory would hand back a *different* mock function each time, making
// call assertions impossible. vi.hoisted keeps this one instance safe to
// reference from both the vi.mock factory (hoisted above imports) and the
// test bodies below.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Phase 16A: case notes are saved through lib/caseLogClient.ts's
// createCaseLogEntry (real `/api/cases/[caseId]/log` round trip as of the
// raw-field-name leak fix follow-up, 2026-10). Mocked here, same as every
// other lib/*Client.ts boundary, so individual tests can make it resolve
// or reject on demand, independent of case creation itself (which stays
// on the real mock casesService.create path — OrganizationProvider
// defaults dataAdapterMode to "mock", so that path never calls fetch
// either) and independent of this file's generic fetch stub (which only
// ever answers the workflow-templates/catalog shape, never case-log's).
vi.mock('@/lib/caseLogClient', () => ({
  createCaseLogEntry: vi.fn(),
  fetchCaseLog: vi.fn(),
}));

// NewCaseModal calls useRouter() (next/navigation) unconditionally on every
// render to navigate on successful submit — outside a real Next.js App
// Router tree that throws, since there's no AppRouterContext.

// useWorkflowTemplates() -> workflowTemplatesService.list() always fetches
// app/api/workflow-templates (it never branches on DATA_ADAPTER client-side
// — see that service's own comment), so a real fetch stub is needed here,
// resolving with the same fixture data that route returns in mock mode.
// Only the tests that need the dynamic per-field <input>s (Phase 16A's new
// ones, below) wait for this to resolve; the pre-existing tests above only
// assert on the modal's static, always-present content and don't need it.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
        catalog: serviceCatalogFixtures,
      }),
    }),
  );
  pushMock.mockClear();
  vi.mocked(createCaseLogEntry).mockReset().mockResolvedValue({
    id: 'log-test',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'test-case',
    type: 'note',
    text: null,
    contactedWho: null,
    contactedSpoke: null,
    contactSummary: null,
    author: 'Test',
    createdAt: '2026-07-24T00:00:00.000Z',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Manors go-live fix: useSession() now reads from a real Context, not a
// hardcoded stub — tests supply their own explicit value here (still
// staffFixtures[0], preserving every pre-existing assertion below that
// expects that exact name) rather than relying on production code to
// derive it from a fixture.
function renderModal() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider>
        <SessionProvider value={{ staffId: staffFixtures[0].id, displayName: staffFixtures[0].displayName }}>
          <NewCaseModal open onClose={() => {}} />
        </SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

/** Renders the modal and waits for the workflow template's intake fields
    (fetched asynchronously) to actually appear before returning. Waits for
    the full known count (11, since Structured Certifier data (2026-09,
    ADR-041) replaced the single dcContact field with four certifier
    fields, and Time of Death moved from a text <input> to three <select>s
    — see intakeInputs' own updated comment), not just "> 0" — Services &
    Charges' own catalog-driven <input>s (Phase 19C) are fetched by a
    separate query that can resolve before or after the intake fields', so
    a lower threshold could false-positive on those alone while intake
    fields are still loading. */
async function renderModalWithFields() {
  const result = renderModal();
  await waitFor(() => expect(intakeInputs(result.container).length).toBeGreaterThanOrEqual(11));
  return result;
}

/** Phase 19: stubs the workflow-templates fetch with a single custom
    template so a test can exercise a specific fieldType/validationType
    combination without depending on Managed Cremations' own 14-field
    fixture. */
function stubTemplateFetch(template: WorkflowTemplate | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowTemplates: template ? [template] : [], catalog: serviceCatalogFixtures }),
    }),
  );
}

function customTemplate(overrides: Partial<WorkflowTemplate['versions'][0]>): WorkflowTemplate {
  return {
    id: 'custom-template',
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: 'Custom',
    isEnabled: true,
    caseTypes: ['cremation'],
    versions: [
      {
        version: 1,
        caseTypes: ['cremation'],
        createdAt: '2026-01-01T00:00:00.000Z',
        intake: { sections: [] },
        stages: [],
        ...overrides,
      },
    ],
  };
}

describe('NewCaseModal — intake owner is read-only', () => {
  // Manors go-live fix: "Assigned Staff" also displays the same session
  // display name by default (a separate field, right below), so every
  // query here is scoped to "Your name (taking this call)"'s own field
  // specifically — matching this file's established
  // scope-by-field-label pattern.

  it("displays the current session's staff member as plain text", () => {
    renderModal();
    expect(within(screen.getByText('Your name (taking this call)').parentElement!).getByText(staffFixtures[0].displayName)).toBeInTheDocument();
  });

  it('renders no <select> for the intake owner field specifically — no staff picker exists to change it', () => {
    renderModal();
    expect(within(screen.getByText('Your name (taking this call)').parentElement!).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('does not render the intake owner name inside any editable form control', () => {
    renderModal();
    const nameNode = within(screen.getByText('Your name (taking this call)').parentElement!).getByText(staffFixtures[0].displayName);
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

/** Manors go-live fix: "Assigned Staff" defaults to the real authenticated
    caller and is editable only for a role holding `case.reassign` — a
    role without it (the default `fetch` stub's empty permissions list,
    matching Office Staff/every role lacking this key) sees a read-only
    confirmation instead. */
describe('NewCaseModal — Assigned Staff (Manors go-live fix)', () => {
  function stubFetchWithPermissions(permissions: string[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/rbac/my-permissions')) {
          return Promise.resolve({ ok: true, json: async () => ({ identityId: 'id', organizationId: DEFAULT_ORGANIZATION_ID, roleKey: 'officeStaff', permissions }) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
            catalog: serviceCatalogFixtures,
          }),
        });
      }),
    );
  }

  it('defaults to the authenticated session\'s own staff member, without requiring a selection', async () => {
    stubFetchWithPermissions([]); // no case.reassign — e.g. Office Staff
    renderModal();
    const assignedField = within(screen.getByText('Assigned Staff').parentElement!);
    expect(await assignedField.findByText(staffFixtures[0].displayName)).toBeInTheDocument();
  });

  it('a caller without case.reassign sees a read-only value, not a picker — cannot assign the new case to another employee', async () => {
    stubFetchWithPermissions([]);
    renderModal();
    const assignedField = within(screen.getByText('Assigned Staff').parentElement!);
    await assignedField.findByText(staffFixtures[0].displayName);
    expect(assignedField.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('a caller with case.reassign (Administrator/Funeral Director/Manager) sees an editable picker, defaulting to themselves', async () => {
    stubFetchWithPermissions(['case.reassign']);
    renderModal();
    const assignedField = within(screen.getByText('Assigned Staff').parentElement!);
    const select = await assignedField.findByRole('combobox');
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(staffFixtures[0].id));
  });

  it('a caller with case.reassign can pick a different active staff member, and that selection is what the case is created with', async () => {
    stubFetchWithPermissions(['case.reassign']);
    const { container } = renderModal();
    await waitFor(() => expect(intakeInputs(container).length).toBeGreaterThanOrEqual(11));
    fillRequiredFields(container);

    const assignedField = within(screen.getByText('Assigned Staff').parentElement!);
    const select = await assignedField.findByRole('combobox');
    const otherStaff = staffFixtures.find((s) => s.id !== staffFixtures[0].id)!;
    fireEvent.change(select, { target: { value: otherStaff.id } });
    expect((select as HTMLSelectElement).value).toBe(otherStaff.id);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const createdCase = caseFixtures.find((c) => c.id === newCaseId);
    expect(createdCase?.assignedStaffId).toBe(otherStaff.id);
  });
});

/**
 * Phase 16A (New Case UX Polish). Intake fields render in this fixed order
 * (services/__mocks__/workflowTemplates.ts's Managed Cremations template).
 * Structured Certifier data (2026-09, ADR-041) changed this twice over,
 * and the Manors go-live correction (2026-09) changed it a third time:
 * Time of Death moved from a text <input> to three <select>s (dropping
 * out of this <input>-only collection entirely), the single dcContact
 * field was replaced by four certifier fields, and — per the correction —
 * the merged "Contacts" intake section now renders as two distinct
 * visual groups, "Next of Kin / Primary Contact" first, "Certifier
 * Information" second (NewCaseModal.tsx's own contactsSplitIndex), so NOK
 * fields now come *before* Certifier fields in DOM order, the reverse of
 * the template's own raw field order. "Relationship to decedent" (a
 * <select>, not an <input>) and its conditional "Relationship (describe)"
 * text field sit between NOK Phone and the fixed Email field — the
 * "describe" field only exists in the DOM when "Other" is selected, so it
 * is deliberately never assigned a fixed index below.
 *
 * Current order: 0 decedentName, 1 placeOfDeath, 2 dateOfBirth, 3 weight,
 * 4 dateOfDeath, [Time of death — not an <input>], 5 nextOfKinName,
 * 6 nextOfKinPhone, [Relationship to decedent — not an <input>],
 * [Relationship (describe) — conditional, "Other" only], 7 Next of kin —
 * email, 8 certifierName, 9 certifierPhone, 10 certifierLicenseNumber,
 * 11 certifierFax — 12 total (when "Other" is not selected). The old
 * Payment field (Phase 19B) contributed zero inputs and is now fully
 * retired (Phase 19C's Services &amp; Charges section replaces it — see
 * the describe block below); Services &amp; Charges' own <input>s always
 * render *after* these 12. None of these fields have a
 * <label htmlFor>/aria-label association with their visible text (the
 * label is a plain sibling <div>), so tests below select by this fixed
 * position rather than by accessible name.
 */
function intakeInputs(container: HTMLElement) {
  return container.querySelectorAll('input');
}

describe('NewCaseModal — uppercase transform on free-text fields', () => {
  it('uppercases decedentName, placeOfDeath, certifierName, and nextOfKinName as the user types', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[0], { target: { value: 'robert ellison' } });
    fireEvent.change(inputs[1], { target: { value: "st. mary's hospital" } });
    fireEvent.change(inputs[8], { target: { value: 'dr. linda choi' } }); // certifierName
    fireEvent.change(inputs[5], { target: { value: 'karen ellison' } }); // nextOfKinName

    expect(inputs[0]).toHaveValue('ROBERT ELLISON');
    expect(inputs[1]).toHaveValue("ST. MARY'S HOSPITAL");
    expect(inputs[8]).toHaveValue('DR. LINDA CHOI');
    expect(inputs[5]).toHaveValue('KAREN ELLISON');
  });

  it('does not uppercase the phone or weight fields', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[6], { target: { value: '555-abc-1234' } }); // nextOfKinPhone
    fireEvent.change(inputs[3], { target: { value: '165 lb' } }); // weight

    expect(inputs[6]).toHaveValue('555-abc-1234');
    expect(inputs[3]).toHaveValue('165 lb');
  });

  it('does not uppercase certifierPhone/certifierFax (2026-09, ADR-041)', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[9], { target: { value: '555-abc-1234' } }); // certifierPhone
    fireEvent.change(inputs[11], { target: { value: '555-def-5678' } }); // certifierFax

    expect(inputs[9]).toHaveValue('555-abc-1234');
    expect(inputs[11]).toHaveValue('555-def-5678');
  });

  it('uppercases certifierLicenseNumber, matching the tagNumber-style code precedent', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[10], { target: { value: 'md-4471' } }); // certifierLicenseNumber
    expect(inputs[10]).toHaveValue('MD-4471');
  });
});

describe('NewCaseModal — MM/DD/YYYY date mask', () => {
  it('auto-inserts "/" separators when a full 8-digit date is entered at once (paste or fast typing)', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[2], { target: { value: '07202026' } }); // dateOfBirth
    expect(inputs[2]).toHaveValue('07/20/2026');

    fireEvent.change(inputs[4], { target: { value: '12251950' } }); // dateOfDeath
    expect(inputs[4]).toHaveValue('12/25/1950');
  });

  it('formats progressively as the user types digit by digit', async () => {
    const { container } = await renderModalWithFields();
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '0' } });
    expect(dateOfBirth).toHaveValue('0');
    fireEvent.change(dateOfBirth, { target: { value: '07' } });
    expect(dateOfBirth).toHaveValue('07');
    fireEvent.change(dateOfBirth, { target: { value: '072' } });
    expect(dateOfBirth).toHaveValue('07/2');
    fireEvent.change(dateOfBirth, { target: { value: '07/20' } });
    expect(dateOfBirth).toHaveValue('07/20');
    fireEvent.change(dateOfBirth, { target: { value: '07/201' } });
    expect(dateOfBirth).toHaveValue('07/20/1');
  });

  it('ignores non-digit characters and caps at 8 digits (MMDDYYYY)', async () => {
    const { container } = await renderModalWithFields();
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '07/20/202699999' } });
    expect(dateOfBirth).toHaveValue('07/20/2026');
  });

  it('does not apply the date mask to non-date fields', async () => {
    const { container } = await renderModalWithFields();
    const weight = intakeInputs(container)[3];

    fireEvent.change(weight, { target: { value: '165lb' } });
    expect(weight).toHaveValue('165lb');
  });
});

describe('NewCaseModal — two-digit year expansion (Solis go-live checkpoint)', () => {
  it('expands a fully-typed two-digit year on blur, per the spec examples', async () => {
    const { container } = await renderModalWithFields();
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '010585' } });
    expect(dateOfBirth).toHaveValue('01/05/85');
    fireEvent.blur(dateOfBirth);
    expect(dateOfBirth).toHaveValue('01/05/1985');
  });

  it('does not expand while still mid-typing (no blur yet)', async () => {
    const { container } = await renderModalWithFields();
    const dateOfDeath = intakeInputs(container)[4];

    fireEvent.change(dateOfDeath, { target: { value: '092126' } });
    expect(dateOfDeath).toHaveValue('09/21/26'); // not yet expanded
  });

  it('leaves an already-4-digit-year value unchanged on blur', async () => {
    const { container } = await renderModalWithFields();
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '07202026' } });
    fireEvent.blur(dateOfBirth);
    expect(dateOfBirth).toHaveValue('07/20/2026');
  });

  it('persists the expanded four-digit year on the created case, even without an explicit blur before submitting', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '010585' } });
    // Deliberately no fireEvent.blur here — exercises the defensive
    // expansion at submit time, not just the on-blur path.

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const createdCase = caseFixtures.find((c) => c.id === newCaseId);
    expect(createdCase?.dateOfBirth).toBe('01/05/1985');
  });
});

describe('NewCaseModal — DOB/DOD cross-field validation (Solis go-live checkpoint)', () => {
  it('flags Date of Birth after Date of Death and blocks submission', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];
    const dateOfDeath = intakeInputs(container)[4];

    fireEvent.change(dateOfBirth, { target: { value: '07202026' } });
    fireEvent.blur(dateOfBirth);
    fireEvent.change(dateOfDeath, { target: { value: '01052000' } });
    fireEvent.blur(dateOfDeath);

    // Shown under both fields — each one is "wrong" relative to the other.
    expect(screen.getAllByText(/date of birth cannot be after date of death/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('flags a future Date of Death', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfDeath = intakeInputs(container)[4];

    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(dateOfDeath, { target: { value: `0101${farFutureYear}` } });
    fireEvent.blur(dateOfDeath);

    expect(screen.getByText(/date of death cannot be in the future/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('allows a valid DOB/DOD pair and clears the error once corrected', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];
    const dateOfDeath = intakeInputs(container)[4];

    fireEvent.change(dateOfBirth, { target: { value: '07202026' } });
    fireEvent.blur(dateOfBirth);
    fireEvent.change(dateOfDeath, { target: { value: '01052000' } });
    fireEvent.blur(dateOfDeath);
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();

    fireEvent.change(dateOfBirth, { target: { value: '01011950' } });
    fireEvent.blur(dateOfBirth);

    expect(screen.queryByText(/date of birth cannot be after date of death/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });
});

describe('NewCaseModal — Task #15 (2026-09, future-historical-date validation)', () => {
  it('flags a future Date of Birth', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    const farFutureYear = new Date().getFullYear() + 5;
    fireEvent.change(dateOfBirth, { target: { value: `0101${farFutureYear}` } });
    fireEvent.blur(dateOfBirth);

    expect(screen.getByText(/date of birth cannot be in the future/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('accepts a Date of Birth of today', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    fireEvent.change(dateOfBirth, { target: { value: `${mm}${dd}${yyyy}` } });
    fireEvent.blur(dateOfBirth);

    expect(screen.queryByText(/date of birth cannot be in the future/i)).not.toBeInTheDocument();
  });

  it('accepts a Date of Death of today', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfDeath = intakeInputs(container)[4];

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    fireEvent.change(dateOfDeath, { target: { value: `${mm}${dd}${yyyy}` } });
    fireEvent.blur(dateOfDeath);

    expect(screen.queryByText(/date of death cannot be in the future/i)).not.toBeInTheDocument();
  });

  it('a valid Date of Birth still allows case creation to succeed', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '01051950' } });
    fireEvent.blur(dateOfBirth);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const createdCase = caseFixtures.find((c) => c.id === newCaseId);
    expect(createdCase?.dateOfBirth).toBe('01/05/1950');
  });
});

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Replaces the
 * old informational-only Payment intake field entirely — a hardcoded
 * section (like "Your name (taking this call)"), never template-driven,
 * fetching whatever the organization's real service catalog contains
 * rather than hardcoding any service code (see
 * components/case/ServicesAndChargesSelector.tsx).
 */
describe('NewCaseModal — Services & Charges (Phase 19C)', () => {
  it('renders the base service, weight tier options, and add-ons from the fetched catalog — never a hardcoded price', async () => {
    await renderModalWithFields();
    expect((await screen.findAllByText('Direct Cremation')).length).toBeGreaterThan(0);
    expect(screen.getByText('Under 200 lb')).toBeInTheDocument();
    expect(screen.getByText(/201–250 lb/)).toBeInTheDocument();
    expect(screen.getByText(/251–300 lb/)).toBeInTheDocument();
    expect(screen.getByText('Mail Cremated Remains')).toBeInTheDocument();
    expect(screen.getByText('Extra Death Certificate')).toBeInTheDocument();
  });

  it('renders no card number, expiration, or CVV input anywhere', async () => {
    const { container } = await renderModalWithFields();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it('shows a live itemized summary that updates as selections change, and never gates submission', async () => {
    const { container } = await renderModalWithFields();
    await screen.findAllByText('Direct Cremation');
    fillRequiredFields(container);

    expect(screen.getByText('Live Itemized Summary')).toBeInTheDocument();
    // base only, under_200 selected by default — appears in both the line
    // item and the total row, since they're equal at this point.
    expect(screen.getAllByText('$890.00').length).toBeGreaterThanOrEqual(2);

    const surchargeRadio = screen.getByText(/201–250 lb/).closest('label')!.querySelector('input')!;
    fireEvent.click(surchargeRadio);
    expect(screen.getByText('$1,180.00')).toBeInTheDocument(); // $890 + $290, total row (line item shows $290 alone)

    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });

});

describe('NewCaseModal — Next of kin email (Manors launch-prep)', () => {
  it('renders a fixed, always-present "Next of kin — email" field, independent of the org template', async () => {
    await renderModalWithFields();
    expect(screen.getByLabelText('Next of kin — email (optional)')).toBeInTheDocument();
  });

  it('allows creating a case with no NOK email at all', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });

  it('trims whitespace on blur', async () => {
    await renderModalWithFields();
    const input = screen.getByLabelText('Next of kin — email (optional)');
    fireEvent.change(input, { target: { value: '  karen@example.com  ' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('karen@example.com');
  });

  it('shows an inline error and blocks submission for an invalid (non-empty) email', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const input = screen.getByLabelText('Next of kin — email (optional)');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.blur(input);

    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('does not block submission for a valid email', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const input = screen.getByLabelText('Next of kin — email (optional)');
    fireEvent.change(input, { target: { value: 'karen@example.com' } });
    fireEvent.blur(input);

    expect(screen.queryByText(/valid email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });

  it('does not render an empty "Payment" section label — its only field (fieldType payment) renders nothing', async () => {
    // The default fixture template's trailing section is literally { key:
    // 'payment', label: 'Payment', fields: [{ fieldType: 'payment' }] } —
    // renderIntakeField renders nothing for a 'payment' field, so this
    // section previously showed just an empty labeled box.
    await renderModalWithFields();
    expect(screen.queryByText('Payment')).not.toBeInTheDocument();
  });

  it('places the NOK email field immediately after the section holding this org\'s own next-of-kin fields, not after a later payment-only section', async () => {
    await renderModalWithFields();
    const nokPhoneLabel = screen.getByText('Next of kin — phone number');
    const nokEmailLabel = screen.getByText('Next of kin — email (optional)');

    // DOCUMENT_POSITION_FOLLOWING (4) means nokEmailLabel comes after
    // nokPhoneLabel in document order.
    expect(nokPhoneLabel.compareDocumentPosition(nokEmailLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Manors go-live correction (2026-09): the only field-label allowed
    // between NOK phone and NOK email is now "Relationship to decedent"
    // (also a fixed field grouped with Next of Kin) — anything else
    // sitting between them would mean a Certifier (or other) field
    // leaked into this group.
    // SOLIS Final Phase (2026-10): field labels are now the shared,
    // un-hashed `sx-label` class (styles.fieldLabel/.fieldLabelRequired no
    // longer exist) — same DOM-order label collection, new selector.
    const allLabels = Array.from(document.querySelectorAll('[class*="sx-label"]')).map((el) => el.textContent);
    const phoneIndex = allLabels.indexOf('Next of kin — phone number');
    expect(allLabels[phoneIndex + 1]).toBe('Relationship to decedent');
    expect(allLabels[phoneIndex + 2]).toBe('Next of kin — email (optional)');
  });
});

describe('NewCaseModal — Services & Charges catalog fallback (Phase 19C)', () => {
  it('never renders a hardcoded price if the catalog fetch returns nothing (still renders the rest of the form)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
          catalog: [],
        }),
      }),
    );
    const { container } = await renderModalWithFields();
    expect(screen.queryByText('Direct Cremation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeInTheDocument();
    fillRequiredFields(container);
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });
});

describe('NewCaseModal — Create Case & Collect with Clover (Phase 19C)', () => {
  it('creates the case order, starts a Clover checkout for its balanceDue, and redirects — never a manually-entered amount', async () => {
    const originalLocation = window.location;
    // @ts-expect-error — redefining window.location for a redirect assertion, standard JSDOM pattern
    delete window.location;
    // @ts-expect-error — partial Location stand-in, only `href` is exercised
    window.location = { href: '' };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/cases/') && url.includes('/order')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              order: { id: 'order-1', balanceDue: 89_000 },
              lineItems: [],
              auditEntries: [],
            }),
          });
        }
        if (url.includes('/payments/clover/checkout')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ paymentId: 'payment-1', checkoutUrl: 'https://clover.test/checkout-1' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
            catalog: serviceCatalogFixtures,
          }),
        });
      }),
    );

    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.click(screen.getByRole('button', { name: 'Create Case & Collect with Clover' }));

    await waitFor(() => expect(window.location.href).toBe('https://clover.test/checkout-1'));
    expect(pushMock).not.toHaveBeenCalled(); // redirected to Clover instead of navigating in-app

    // @ts-expect-error — restoring the real window.location after the test
    window.location = originalLocation;
  });
});

/** Fills the three fields required to submit (decedentName, nextOfKinName,
    nextOfKinPhone) — everything else stays blank/optional. */
function fillRequiredFields(container: HTMLElement) {
  const inputs = intakeInputs(container);
  fireEvent.change(inputs[0], { target: { value: 'Test Decedent' } });
  fireEvent.change(inputs[5], { target: { value: 'Test NOK' } }); // nextOfKinName
  fireEvent.change(inputs[6], { target: { value: '555-0000' } }); // nextOfKinPhone
}

describe('NewCaseModal — calendar date and expiry validation', () => {
  it('shows an error and blocks submission once an invalid date is entered and the field is blurred', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '02302026' } }); // Feb 30 doesn't exist
    fireEvent.blur(dateOfBirth);

    expect(screen.getByText(/enter a valid date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('does not show an error while a date is only partially typed (not yet blurred away from)', async () => {
    const { container } = await renderModalWithFields();
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '07' } });
    expect(screen.queryByText(/enter a valid date/i)).not.toBeInTheDocument();
  });

  it('shows no error and allows submission once a real calendar date is entered', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const dateOfBirth = intakeInputs(container)[2];

    fireEvent.change(dateOfBirth, { target: { value: '07202026' } });
    fireEvent.blur(dateOfBirth);

    expect(screen.queryByText(/enter a valid date/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });

  // Phase 19A (Secure Payment Architecture): the old "cardExp" expiration
  // field/validation test that lived here is gone along with the
  // standalone 'expiration' fieldType and validationType it exercised —
  // card expiration is now collected only inside the isolated, non-
  // validated, non-persisted payment section (see the "secure payment
  // section" describe block below), which never gates Create Case on
  // anything typed into it.
});

/**
 * Time of Death — New Case 12-hour entry (2026-09, ADR-041). Replaces the
 * old 24-hour masked-text-input tests above — the field is now three
 * always-visible <select>s (hour/minute/AM-PM), reusing
 * splitMilitaryTimeToTwelveHourParts/combineTwelveHourTimeParts from
 * utils/inputMask.ts (the same utilities CaseInformationCard's
 * TwelveHourTimeField already established, commit 73015be) — no duplicate
 * parsing logic, and no Save/Cancel shell (this modal has one overall
 * submit action).
 */
describe('NewCaseModal — Time of Death 12-hour entry (2026-09, ADR-041)', () => {
  it('renders three always-visible selects (Hour/Minute/AM-PM), never a masked text input', async () => {
    await renderModalWithFields();
    expect(screen.getByRole('combobox', { name: 'Time of death — hour' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Time of death — minute' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Time of death — AM or PM' })).toBeInTheDocument();
  });

  it('starts blank — never auto-populated with the current time', async () => {
    await renderModalWithFields();
    expect(screen.getByRole('combobox', { name: 'Time of death — hour' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Time of death — minute' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Time of death — AM or PM' })).toHaveValue('');
  });

  it('combines all three selections into canonical 24-hour HH:mm on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — minute' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — AM or PM' }), { target: { value: 'PM' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const createdCase = caseFixtures.find((c) => c.id === newCaseId);
    expect(createdCase?.timeOfDeath).toBe('14:30');
  });

  it('midnight (12:00 AM) and noon (12:00 PM) both round-trip correctly', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — minute' }), { target: { value: '00' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — AM or PM' }), { target: { value: 'AM' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.timeOfDeath).toBe('00:00');
  });

  it('an incomplete selection (only hour + minute chosen) never blocks case creation — Time of Death is optional', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — minute' }), { target: { value: '30' } });
    // AM/PM deliberately left unselected — combineTwelveHourTimeParts
    // rejects the incomplete combination, so timeOfDeath stays unset
    // rather than persisting a guessed value (creation defaults an unset
    // timeOfDeath to '—', matching every other omitted-at-intake field).

    const createButton = screen.getByRole('button', { name: 'Create case' });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.timeOfDeath).toBe('—');
  });

  it('changing an already-complete selection recombines correctly (remains easy to correct)', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '9' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — minute' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — AM or PM' }), { target: { value: 'AM' } });
    // Correct the hour after the full combination was already valid.
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '11' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.timeOfDeath).toBe('11:30');
  });
});

/**
 * Structured Certifier data — New Case persistence fix (2026-09, ADR-041).
 * Root cause: handleSubmit's createCase.mutateAsync payload was a
 * hand-written object literal that never read
 * structuredFields.certifierName/certifierPhone/certifierLicenseNumber/
 * certifierFax — even though buildStructuredCaseFields (already called for
 * decedentName/placeOfDeath/weight/etc.) computed them correctly from the
 * v5 intake's mapsToCaseField. Values typed into the New Case modal's
 * Certifier fields were silently discarded on submit. Fixed by forwarding
 * them the same way as timeOfDeath/placeOfDeath/weight — these tests
 * exercise the complete path (typed input -> intakeInputs indices 5-8,
 * per this file's own index comment -> createCase payload -> created
 * Case), never a re-parse of buildStructuredCaseFields' own logic.
 */
describe('NewCaseModal — Certifier fields persist on New Case creation (2026-09, ADR-041 fix)', () => {
  it('1. Certifier Name entered is included on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(intakeInputs(container)[8], { target: { value: 'dr. jane foster' } }); // certifierName

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierName).toBe('DR. JANE FOSTER');
  });

  it('2. Certifier Phone entered is included on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(intakeInputs(container)[9], { target: { value: '555-0199' } }); // certifierPhone

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierPhone).toBe('555-0199');
  });

  it('3. Certifier License Number entered is included on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(intakeInputs(container)[10], { target: { value: 'md-4471' } }); // certifierLicenseNumber

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierLicenseNumber).toBe('MD-4471');
  });

  it('4. Certifier Fax entered is included on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(intakeInputs(container)[11], { target: { value: '555-0188' } }); // certifierFax

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierFax).toBe('555-0188');
  });

  it('5. all four Certifier fields entered together survive submission', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } });
    fireEvent.change(inputs[9], { target: { value: '555-0199' } });
    fireEvent.change(inputs[10], { target: { value: 'md-4471' } });
    fireEvent.change(inputs[11], { target: { value: '555-0188' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId);
    expect(created?.certifierName).toBe('DR. JANE FOSTER');
    expect(created?.certifierPhone).toBe('555-0199');
    expect(created?.certifierLicenseNumber).toBe('MD-4471');
    expect(created?.certifierFax).toBe('555-0188');
  });

  it('6. Certifier License Number left blank does not prevent case creation', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } });
    fireEvent.change(inputs[9], { target: { value: '555-0199' } });
    // certifierLicenseNumber (inputs[10]) intentionally left blank.

    const createButton = screen.getByRole('button', { name: 'Create case' });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierLicenseNumber).toBeNull();
  });

  it('7. Certifier Fax left blank does not prevent case creation', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } });
    fireEvent.change(inputs[9], { target: { value: '555-0199' } });
    // certifierFax (inputs[11]) intentionally left blank.

    const createButton = screen.getByRole('button', { name: 'Create case' });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    expect(caseFixtures.find((c) => c.id === newCaseId)?.certifierFax).toBeNull();
  });

  it('8. every Certifier field left blank creates the case with all four null (optional at intake)', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    const createButton = screen.getByRole('button', { name: 'Create case' });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId);
    expect(created?.certifierName).toBeNull();
    expect(created?.certifierPhone).toBeNull();
    expect(created?.certifierLicenseNumber).toBeNull();
    expect(created?.certifierFax).toBeNull();
  });

  describe('Name/Phone checklist completion semantics remain unchanged (requiredCaseFields)', () => {
    it('9. Name only -> Certifier Information checklist item is incomplete', async () => {
      const { container } = await renderModalWithFields();
      fillRequiredFields(container);
      fireEvent.change(intakeInputs(container)[8], { target: { value: 'dr. jane foster' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
      const created = caseFixtures.find((c) => c.id === newCaseId)!;
      const items = created.workflowSnapshot!.stages.find((s) => s.rawStage === 0)!.checklist.items;
      const resolved = resolveChecklist(items, created.rawStage, created);
      expect(resolved[6].label).toBe('Certifier Information');
      expect(resolved[6].done).toBe(false);
    });

    it('10. Phone only -> Certifier Information checklist item is incomplete', async () => {
      const { container } = await renderModalWithFields();
      fillRequiredFields(container);
      fireEvent.change(intakeInputs(container)[9], { target: { value: '555-0199' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
      const created = caseFixtures.find((c) => c.id === newCaseId)!;
      const items = created.workflowSnapshot!.stages.find((s) => s.rawStage === 0)!.checklist.items;
      expect(resolveChecklist(items, created.rawStage, created)[6].done).toBe(false);
    });

    it('11. Name + Phone -> Certifier Information checklist item is complete', async () => {
      const { container } = await renderModalWithFields();
      fillRequiredFields(container);
      const inputs = intakeInputs(container);
      fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } });
      fireEvent.change(inputs[9], { target: { value: '555-0199' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
      const created = caseFixtures.find((c) => c.id === newCaseId)!;
      const items = created.workflowSnapshot!.stages.find((s) => s.rawStage === 0)!.checklist.items;
      expect(resolveChecklist(items, created.rawStage, created)[6].done).toBe(true);
    });
  });

  it('12. every other structured New Case field still submits correctly alongside Certifier fields', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[0], { target: { value: 'robert ellison' } }); // decedentName
    fireEvent.change(inputs[2], { target: { value: '03141951' } }); // dateOfBirth
    fireEvent.change(inputs[4], { target: { value: '07092026' } }); // dateOfDeath
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — hour' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — minute' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Time of death — AM or PM' }), { target: { value: 'PM' } });
    fireEvent.change(inputs[1], { target: { value: "st. mary's hospital" } }); // placeOfDeath
    fireEvent.change(inputs[3], { target: { value: '178 lb' } }); // weight
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } }); // certifierName
    fireEvent.change(inputs[9], { target: { value: '555-0199' } }); // certifierPhone
    fireEvent.change(inputs[5], { target: { value: 'karen ellison' } }); // nextOfKinName
    fireEvent.change(inputs[6], { target: { value: '555-0100' } }); // nextOfKinPhone
    fireEvent.change(screen.getByDisplayValue('Undecided'), { target: { value: 'pickup' } }); // returnMethod

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;

    expect(created.decedentName).toBe('ROBERT ELLISON');
    expect(created.dateOfBirth).toBe('03/14/1951');
    expect(created.dateOfDeath).toBe('07/09/2026');
    expect(created.timeOfDeath).toBe('14:30');
    expect(created.placeOfDeath).toBe("ST. MARY'S HOSPITAL");
    expect(created.weight).toBe('178 lb');
    expect(created.nextOfKinName).toBe('KAREN ELLISON');
    expect(created.nextOfKinPhone).toBe('555-0100');
    expect(created.assignedStaffId).toBe(staffFixtures[0].id);
    expect(created.returnMethod).toBe('pickup');
    expect(created.certifierName).toBe('DR. JANE FOSTER');
    expect(created.certifierPhone).toBe('555-0199');
    // No unrelated fieldValues lost — decedentName/placeOfDeath/dateOfBirth/
    // weight/dateOfDeath/timeOfDeath (indices 0-5) and the combined NOK
    // "Family contact" entry (index 7) all still populate fieldValues,
    // exactly as before this fix — certifier fields (no checklistItemIndex)
    // never contribute a fieldValues key at all.
    expect(created.fieldValues[0]).toBe('ROBERT ELLISON');
    expect(created.fieldValues[1]).toBe("ST. MARY'S HOSPITAL");
    expect(created.fieldValues[2]).toBe('03/14/1951');
    expect(created.fieldValues[3]).toBe('178 lb');
    expect(created.fieldValues[4]).toBe('07/09/2026');
    expect(created.fieldValues[5]).toBe('14:30');
    expect(created.fieldValues[7]).toBe('KAREN ELLISON — 555-0100');
    expect(created.fieldValues[6]).toBeUndefined(); // Certifier Information — never fieldValues-backed
  });

  it('an existing (pre-v5) case\'s frozen workflowSnapshot is unaffected by this fix — no certifier fields, dcContact-era shape intact', () => {
    const existing = caseFixtures[0];
    const intake = existing.workflowSnapshot!.intake;
    const contactsSection = intake.sections.find((s) => s.key === 'contacts')!;
    expect(contactsSection.fields.some((f) => f.key === 'dcContact')).toBe(true);
    expect(contactsSection.fields.some((f) => f.key === 'certifierName')).toBe(false);
  });

  it('6. the New Case form never shows the legacy Hospice/physician wording — consistent Certifier terminology with the Case checklist', async () => {
    const { container } = await renderModalWithFields();
    expect(container.textContent).not.toContain('Hospice');
    expect(screen.getByText('Certifier — name')).toBeInTheDocument();
    expect(screen.getByText('Certifier — phone number')).toBeInTheDocument();
  });
});

/**
 * Manors go-live correction (2026-09). Production Workflow v5's real
 * "Contacts" intake section mixes Next of Kin and Certifier fields
 * together under one label — this is why the earlier reorganization
 * (commit 6dc98a7) only reached Case Detail's CaseInformationCard.tsx (a
 * hand-built, template-independent component) and never reached this
 * modal, which renders section labels straight from the intake
 * template's own `section.label`. NewCaseModal.tsx's `contactsSplitIndex`
 * now detects that one section (by field `key`, never by value) and
 * renders it as two distinct visual groups instead — presentation-only,
 * the persisted v5 template/intake content is never read via any
 * different path and never rewritten.
 */
describe('NewCaseModal — Next of Kin / Certifier contact section organization (2026-09)', () => {
  it('1. renders a "Next of Kin / Primary Contact" heading', async () => {
    await renderModalWithFields();
    expect(screen.getByText('Next of Kin / Primary Contact')).toBeInTheDocument();
  });

  it('2/3/4. NOK Name, NOK Phone, and Relationship to decedent all appear within the Next of Kin / Primary Contact visual group', async () => {
    await renderModalWithFields();
    const group = screen.getByText('Next of Kin / Primary Contact').parentElement!;
    const scoped = within(group);
    expect(scoped.getByText('Next of kin — name')).toBeInTheDocument();
    expect(scoped.getByText('Next of kin — phone number')).toBeInTheDocument();
    expect(scoped.getByText('Relationship to decedent')).toBeInTheDocument();
  });

  it('5. Relationship (describe) only appears once "Other" is selected, and appears within the same Next of Kin group', async () => {
    await renderModalWithFields();
    expect(screen.queryByText('Relationship (describe)')).not.toBeInTheDocument();

    const relationshipSelect = screen.getByRole('combobox', { name: 'Relationship to decedent' });
    fireEvent.change(relationshipSelect, { target: { value: 'other' } });

    const group = screen.getByText('Next of Kin / Primary Contact').parentElement!;
    expect(within(group).getByText('Relationship (describe)')).toBeInTheDocument();
  });

  it('6. separately renders a "Certifier Information" heading', async () => {
    await renderModalWithFields();
    expect(screen.getByText('Certifier Information')).toBeInTheDocument();
  });

  it('7/8/9/10. Certifier Name, Phone, License Number, and Fax all appear within the Certifier Information visual group', async () => {
    await renderModalWithFields();
    const group = screen.getByText('Certifier Information').parentElement!;
    const scoped = within(group);
    expect(scoped.getByText('Certifier — name')).toBeInTheDocument();
    expect(scoped.getByText('Certifier — phone number')).toBeInTheDocument();
    expect(scoped.getByText('Certifier — license number')).toBeInTheDocument();
    expect(scoped.getByText('Certifier — fax number')).toBeInTheDocument();
  });

  it('11. the Certifier helper text is exactly "Medical certifier responsible for signing the death certificate."', async () => {
    await renderModalWithFields();
    expect(screen.getByText('Medical certifier responsible for signing the death certificate.')).toBeInTheDocument();
  });

  it('12. the old helper text containing "never the family contact above" does not render', async () => {
    await renderModalWithFields();
    expect(screen.queryByText(/never the family contact above/i)).not.toBeInTheDocument();
  });

  it('13. Certifier fields are not visually grouped under the Next of Kin / Primary Contact heading', async () => {
    await renderModalWithFields();
    const nokGroup = screen.getByText('Next of Kin / Primary Contact').parentElement!;
    const scoped = within(nokGroup);
    expect(scoped.queryByText('Certifier — name')).not.toBeInTheDocument();
    expect(scoped.queryByText('Certifier — phone number')).not.toBeInTheDocument();
    expect(scoped.queryByText('Certifier — license number')).not.toBeInTheDocument();
    expect(scoped.queryByText('Certifier — fax number')).not.toBeInTheDocument();
  });

  it('14. NOK fields are not visually grouped under Certifier Information', async () => {
    await renderModalWithFields();
    const certifierGroup = screen.getByText('Certifier Information').parentElement!;
    const scoped = within(certifierGroup);
    expect(scoped.queryByText('Next of kin — name')).not.toBeInTheDocument();
    expect(scoped.queryByText('Next of kin — phone number')).not.toBeInTheDocument();
    expect(scoped.queryByText('Relationship to decedent')).not.toBeInTheDocument();
  });

  it('15. submission persists NOK Name, Phone, Relationship, and Relationship Other', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[0], { target: { value: 'Robert Ellison' } }); // decedentName
    fireEvent.change(inputs[5], { target: { value: 'karen ellison' } }); // nextOfKinName
    fireEvent.change(inputs[6], { target: { value: '555-0100' } }); // nextOfKinPhone
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship to decedent' }), { target: { value: 'other' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Relationship (describe)' }), { target: { value: 'family friend' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;

    expect(created.nextOfKinName).toBe('KAREN ELLISON');
    expect(created.nextOfKinPhone).toBe('555-0100');
    expect(created.nextOfKinRelationship).toBe('other');
    expect(created.nextOfKinRelationshipOther).toBe('FAMILY FRIEND');
  });

  it('a Relationship other than "Other" persists without a Relationship Other value', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship to decedent' }), { target: { value: 'spouse' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;

    expect(created.nextOfKinRelationship).toBe('spouse');
    expect(created.nextOfKinRelationshipOther).toBeNull();
  });

  it('leaving Relationship unset persists null, never a guessed value', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;

    expect(created.nextOfKinRelationship).toBeNull();
    expect(created.nextOfKinRelationshipOther).toBeNull();
  });

  it('16. submission persists all four Certifier fields', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } }); // certifierName
    fireEvent.change(inputs[9], { target: { value: '555-0199' } }); // certifierPhone
    fireEvent.change(inputs[10], { target: { value: 'md-4471' } }); // certifierLicenseNumber
    fireEvent.change(inputs[11], { target: { value: '555-0188' } }); // certifierFax

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;

    expect(created.certifierName).toBe('DR. JANE FOSTER');
    expect(created.certifierPhone).toBe('555-0199');
    expect(created.certifierLicenseNumber).toBe('MD-4471');
    expect(created.certifierFax).toBe('555-0188');
  });

  it('17. Certifier checklist completion remains Name + Phone only, unaffected by the visual reorganization', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[8], { target: { value: 'dr. jane foster' } }); // certifierName
    fireEvent.change(inputs[10], { target: { value: 'md-4471' } }); // certifierLicenseNumber — deliberately no phone

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const created = caseFixtures.find((c) => c.id === newCaseId)!;
    const items = created.workflowSnapshot!.stages.find((s) => s.rawStage === 0)!.checklist.items;
    expect(resolveChecklist(items, created.rawStage, created)[6].done).toBe(false); // Name only — still incomplete
  });
});

describe('NewCaseModal — initial case note', () => {
  it('does not call createCaseLogEntry when the note is left blank', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(createCaseLogEntry).not.toHaveBeenCalled();
  });

  it('does not call createCaseLogEntry when the note is only whitespace', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '   \n  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(createCaseLogEntry).not.toHaveBeenCalled();
  });

  it('saves a non-blank note through createCaseLogEntry with the new caseId and trusted organizationId — preserving internal line breaks, trimming only the outer whitespace, and claiming no author', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const noteText = '  Family requested a biodegradable urn.\nMail death certificate to next of kin.  ';
    fireEvent.change(container.querySelector('textarea')!, { target: { value: noteText } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(createCaseLogEntry).toHaveBeenCalled());

    const [caseId, organizationId, input] = vi.mocked(createCaseLogEntry).mock.calls[0];
    expect(organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(typeof caseId).toBe('string');
    expect(caseId.length).toBeGreaterThan(0);
    // No `author`: attribution is resolved server-side from the
    // authenticated caller, never claimed by the browser — see
    // app/api/cases/[caseId]/log/route.ts.
    expect(input).toEqual({
      type: 'note',
      text: 'Family requested a biodegradable urn.\nMail death certificate to next of kin.',
    });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/cases/${caseId}`));
  });
});

describe('NewCaseModal — partial-failure handling when the note fails to save', () => {
  it('shows a partial-success message, keeps the note text, and does not navigate away automatically', async () => {
    vi.mocked(createCaseLogEntry).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/case created successfully.*couldn't save your note/i);
    expect(container.querySelector('textarea')).toHaveValue('Important note');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('"Retry saving note" re-attempts only the note, never re-creates the case, and navigates once it succeeds', async () => {
    vi.mocked(createCaseLogEntry).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await screen.findByRole('alert');

    const callsBeforeRetry = vi.mocked(createCaseLogEntry).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving note' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(vi.mocked(createCaseLogEntry).mock.calls.length).toBe(callsBeforeRetry + 1);
    // Same caseId on both the failed attempt and the retry — proof no second case was created.
    const firstCaseId = vi.mocked(createCaseLogEntry).mock.calls[0][0];
    const retryCaseId = vi.mocked(createCaseLogEntry).mock.calls[1][0];
    expect(retryCaseId).toBe(firstCaseId);
  });

  it('"Continue without note" navigates to the created case without retrying the note', async () => {
    vi.mocked(createCaseLogEntry).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await screen.findByRole('alert');

    const callsBeforeContinue = vi.mocked(createCaseLogEntry).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Continue without note' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(vi.mocked(createCaseLogEntry).mock.calls.length).toBe(callsBeforeContinue);
  });
});

describe('NewCaseModal — configurable field types render correctly (Phase 19)', () => {
  it('renders a select field with its configured options', async () => {
    stubTemplateFetch(
      customTemplate({
        intake: {
          sections: [
            {
              key: 's',
              label: 'S',
              fields: [
                { key: 'decedentName', label: 'Name', fieldType: 'text', required: true, mapsToCaseField: 'decedentName' },
                { key: 'referral', label: 'Referral source', fieldType: 'select', options: ['Hospital', 'Hospice', 'Web'] },
              ],
            },
          ],
        },
      }),
    );
    renderModal();
    const select = (await screen.findByLabelText('Referral source')) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toEqual(['Select…', 'Hospital', 'Hospice', 'Web']);
  });

  it('renders a checkbox field and toggles its value', async () => {
    stubTemplateFetch(
      customTemplate({
        intake: {
          sections: [
            {
              key: 's',
              label: 'S',
              fields: [
                { key: 'decedentName', label: 'Name', fieldType: 'text', required: true, mapsToCaseField: 'decedentName' },
                { key: 'wantsService', label: 'Wants a memorial service', fieldType: 'checkbox' },
              ],
            },
          ],
        },
      }),
    );
    renderModal();
    const checkbox = await screen.findByRole('checkbox', { name: 'Wants a memorial service' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('renders a textarea for a textarea-type field', async () => {
    stubTemplateFetch(
      customTemplate({
        intake: {
          sections: [
            {
              key: 's',
              label: 'S',
              fields: [
                { key: 'decedentName', label: 'Name', fieldType: 'text', required: true, mapsToCaseField: 'decedentName' },
                { key: 'specialInstructions', label: 'Special instructions', fieldType: 'textarea' },
              ],
            },
          ],
        },
      }),
    );
    renderModal();
    // Two textareas exist once loaded: this field, plus the always-present
    // Notes field.
    expect(await screen.findByLabelText('Special instructions')).toBeInTheDocument();
  });

  it('validates an email field using the configured validationType', async () => {
    stubTemplateFetch(
      customTemplate({
        intake: {
          sections: [
            {
              key: 's',
              label: 'S',
              fields: [
                { key: 'decedentName', label: 'Name', fieldType: 'text', required: true, mapsToCaseField: 'decedentName' },
                { key: 'familyEmail', label: 'Family email', fieldType: 'email', validationType: 'email' },
              ],
            },
          ],
        },
      }),
    );
    const { container } = renderModal();
    // Intake <input>s only — excludes the always-present Notes <textarea>,
    // which also has an implicit "textbox" role and would otherwise collide
    // with a role-based query. Plus Services & Charges' own fixed input
    // count, which always renders after these.
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(2 + SERVICES_AND_CHARGES_INPUT_COUNT));
    const emailInput = container.querySelectorAll('input')[1];

    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.blur(emailInput);
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'family@example.com' } });
    expect(screen.queryByText(/valid email/i)).not.toBeInTheDocument();
  });

  it('generically gates submission on any field marked required, not just decedentName', async () => {
    stubTemplateFetch(
      customTemplate({
        intake: {
          sections: [
            {
              key: 's',
              label: 'S',
              fields: [
                { key: 'decedentName', label: 'Name', fieldType: 'text', required: true, mapsToCaseField: 'decedentName' },
                { key: 'referredBy', label: 'Referred by', fieldType: 'text', required: true },
              ],
            },
          ],
        },
      }),
    );
    const { container } = renderModal();
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(2 + SERVICES_AND_CHARGES_INPUT_COUNT));
    const inputs = container.querySelectorAll('input');

    fireEvent.change(inputs[0], { target: { value: 'Test Decedent' } });
    // decedentName alone is filled, but "Referred by" is also required and still blank.
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();

    fireEvent.change(inputs[1], { target: { value: 'Hospital' } });
    expect(screen.getByRole('button', { name: 'Create case' })).not.toBeDisabled();
  });
});

describe('NewCaseModal — backward compatibility (Phase 19)', () => {
  it('falls back to a minimal default intake form when the enabled template has zero intake sections', async () => {
    stubTemplateFetch(customTemplate({ intake: { sections: [] } }));
    renderModal();

    // The fallback's three fields (decedent name, next of kin name/phone) —
    // not a blank form.
    await waitFor(() => expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(3));
    expect(screen.getByText('Name of deceased')).toBeInTheDocument();
    expect(screen.getByText('Next of kin — name')).toBeInTheDocument();
    expect(screen.getByText('Next of kin — phone number')).toBeInTheDocument();
  });

  it('falls back to the default form when there is no enabled template at all', async () => {
    stubTemplateFetch(null);
    renderModal();
    await waitFor(() => expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(3));
    expect(screen.getByText('Name of deceased')).toBeInTheDocument();
  });

  it('does not show the fallback form momentarily while the real template is still loading', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );
    const { container } = renderModal();

    // While the fetch is still pending, nothing dynamic has rendered yet —
    // no fallback flash before the real data (or genuine absence of it) is
    // known.
    expect(container.querySelectorAll('input').length).toBe(0);

    resolveFetch({
      ok: true,
      // A single shared promise resolves every pending fetch call
      // (workflow-templates AND service-catalog both awaited the same
      // one) — merging both response shapes into one object lets each
      // caller read its own key regardless of which call this resolves.
      json: async () => ({
        workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
        catalog: serviceCatalogFixtures,
      }),
    });
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(11 + SERVICES_AND_CHARGES_INPUT_COUNT));
  });
});

