import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewCaseModal } from './NewCaseModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { staffFixtures, caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseLogService } from '@/services/caseLogService';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

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

// Phase 16A: case notes are saved through the *existing*
// services/caseLogService.ts (see NewCaseModal.tsx's own architecture
// comment on why this doesn't yet reach Wix). Mocked here so individual
// tests can make it resolve or reject on demand, independent of case
// creation itself (which stays on the real mock casesService.create path
// — OrganizationProvider defaults dataAdapterMode to "mock", so that path
// never calls fetch either).
vi.mock('@/services/caseLogService', () => ({
  caseLogService: { create: vi.fn(), list: vi.fn() },
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
      }),
    }),
  );
  pushMock.mockClear();
  vi.mocked(caseLogService.create).mockReset().mockResolvedValue({
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

/** Renders the modal and waits for the workflow template's intake fields
    (fetched asynchronously) to actually appear before returning. */
async function renderModalWithFields() {
  const result = renderModal();
  await waitFor(() => expect(intakeInputs(result.container).length).toBeGreaterThan(0));
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
      json: async () => ({ workflowTemplates: template ? [template] : [] }),
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

/**
 * Phase 16A (New Case UX Polish). Intake fields render in this fixed order
 * (services/__mocks__/workflowTemplates.ts's Managed Cremations template):
 * 0 decedentName, 1 placeOfDeath, 2 dateOfBirth, 3 weight, 4 dateOfDeath,
 * 5 timeOfDeath, 6 dcContact, 7 nextOfKinName, 8 nextOfKinPhone,
 * 9 cardName, 10 cardNumber, 11 cardExp, 12 cardCvv, 13 cardZip. None of
 * these fields have a <label htmlFor>/aria-label association with their
 * visible text (the label is a plain sibling <div>), so tests below select
 * by this fixed position rather than by accessible name.
 */
function intakeInputs(container: HTMLElement) {
  return container.querySelectorAll('input');
}

describe('NewCaseModal — uppercase transform on free-text fields', () => {
  it('uppercases decedentName, placeOfDeath, dcContact, and nextOfKinName as the user types', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[0], { target: { value: 'robert ellison' } });
    fireEvent.change(inputs[1], { target: { value: "st. mary's hospital" } });
    fireEvent.change(inputs[6], { target: { value: 'dr. linda choi' } });
    fireEvent.change(inputs[7], { target: { value: 'karen ellison' } });

    expect(inputs[0]).toHaveValue('ROBERT ELLISON');
    expect(inputs[1]).toHaveValue("ST. MARY'S HOSPITAL");
    expect(inputs[6]).toHaveValue('DR. LINDA CHOI');
    expect(inputs[7]).toHaveValue('KAREN ELLISON');
  });

  it('does not uppercase the phone, weight, or time fields', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[8], { target: { value: '555-abc-1234' } }); // nextOfKinPhone
    fireEvent.change(inputs[3], { target: { value: '165 lb' } }); // weight
    fireEvent.change(inputs[5], { target: { value: '14:30pm' } }); // timeOfDeath

    expect(inputs[8]).toHaveValue('555-abc-1234');
    expect(inputs[3]).toHaveValue('165 lb');
    expect(inputs[5]).toHaveValue('14:30pm');
  });

  it('does not uppercase any Payment-group field, including cardName (a name field, but a "credit card value" per this phase\'s own scope)', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    fireEvent.change(inputs[9], { target: { value: 'john smith' } }); // cardName
    fireEvent.change(inputs[10], { target: { value: '4111 1111 1111 1111' } }); // cardNumber
    fireEvent.change(inputs[11], { target: { value: '12/28' } }); // cardExp
    fireEvent.change(inputs[12], { target: { value: '123' } }); // cardCvv
    fireEvent.change(inputs[13], { target: { value: '94112' } }); // cardZip

    expect(inputs[9]).toHaveValue('john smith');
    expect(inputs[10]).toHaveValue('4111 1111 1111 1111');
    expect(inputs[11]).toHaveValue('12/28');
    expect(inputs[12]).toHaveValue('123');
    expect(inputs[13]).toHaveValue('94112');
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

describe('NewCaseModal — credit card fields masked by default with a show/hide toggle', () => {
  it('renders cardNumber and cardCvv masked (type="password") by default; other fields, including cardExp/cardZip, are plain text', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);

    expect(inputs[10].getAttribute('type')).toBe('password'); // cardNumber
    expect(inputs[12].getAttribute('type')).toBe('password'); // cardCvv
    expect(inputs[11].getAttribute('type')).toBe('text'); // cardExp — never password-flagged
    expect(inputs[13].getAttribute('type')).toBe('text'); // cardZip — never password-flagged
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });

  it('reveals cardNumber as plain text after clicking its Show toggle, and can be hidden again', async () => {
    const { container } = await renderModalWithFields();
    const inputs = intakeInputs(container);
    fireEvent.change(inputs[10], { target: { value: '4111111111111111' } });

    const showButton = screen.getByRole('button', { name: /show card number/i });
    fireEvent.click(showButton);
    expect(intakeInputs(container)[10].getAttribute('type')).toBe('text');
    expect(intakeInputs(container)[10]).toHaveValue('4111111111111111');

    const hideButton = screen.getByRole('button', { name: /hide card number/i });
    fireEvent.click(hideButton);
    expect(intakeInputs(container)[10].getAttribute('type')).toBe('password');
  });

  it('reveals cardCvv independently of cardNumber', async () => {
    const { container } = await renderModalWithFields();
    fireEvent.click(screen.getByRole('button', { name: /show cvv/i }));

    const inputs = intakeInputs(container);
    expect(inputs[12].getAttribute('type')).toBe('text'); // cardCvv revealed
    expect(inputs[10].getAttribute('type')).toBe('password'); // cardNumber still masked
  });
});

/** Fills the three fields required to submit (decedentName, nextOfKinName,
    nextOfKinPhone) — everything else stays blank/optional. */
function fillRequiredFields(container: HTMLElement) {
  const inputs = intakeInputs(container);
  fireEvent.change(inputs[0], { target: { value: 'Test Decedent' } });
  fireEvent.change(inputs[7], { target: { value: 'Test NOK' } });
  fireEvent.change(inputs[8], { target: { value: '555-0000' } });
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

  it('shows an error and blocks submission for an out-of-range expiry month', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const cardExp = intakeInputs(container)[11];

    fireEvent.change(cardExp, { target: { value: '1328' } }); // month 13
    fireEvent.blur(cardExp);

    expect(screen.getByText(/enter a valid expiration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });
});

describe('NewCaseModal — time input normalization (Phase 19.1)', () => {
  it('normalizes a 12-hour PM value to 24-hour HH:mm once the field is blurred', async () => {
    const { container } = await renderModalWithFields();
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '2:30 PM' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('14:30');
  });

  it('normalizes a 12-hour AM value to 24-hour HH:mm', async () => {
    const { container } = await renderModalWithFields();
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '2:30 AM' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('02:30');
  });

  it('normalizes noon and midnight correctly', async () => {
    const { container } = await renderModalWithFields();
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '12:00 PM' } });
    fireEvent.blur(timeOfDeath);
    expect(timeOfDeath).toHaveValue('12:00');

    fireEvent.change(timeOfDeath, { target: { value: '12:00 AM' } });
    fireEvent.blur(timeOfDeath);
    expect(timeOfDeath).toHaveValue('00:00');
  });

  it('accepts direct 24-hour input unchanged', async () => {
    const { container } = await renderModalWithFields();
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '14:30' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('14:30');
  });

  it('accepts lowercase am/pm', async () => {
    const { container } = await renderModalWithFields();
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '02:30 am' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('02:30');
  });

  it('preserves invalid input for correction and shows an inline error, without normalizing it', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '25:00' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('25:00'); // unchanged, not silently cleared or altered
    expect(screen.getByText(/enter a valid time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('rejects an ambiguous value with no AM/PM marker', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '2:30' } });
    fireEvent.blur(timeOfDeath);

    expect(timeOfDeath).toHaveValue('2:30');
    expect(screen.getByText(/enter a valid time/i)).toBeInTheDocument();
  });

  it('rejects an invalid hour/minute combination like "12:75 PM"', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '12:75 PM' } });
    fireEvent.blur(timeOfDeath);

    expect(screen.getByText(/enter a valid time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
  });

  it('persists the normalized HH:mm value — not the raw typed text — on the created case', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const timeOfDeath = intakeInputs(container)[5];

    fireEvent.change(timeOfDeath, { target: { value: '2:30 PM' } });
    fireEvent.blur(timeOfDeath);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const newCaseId = pushMock.mock.calls[0][0].split('/cases/')[1];
    const createdCase = caseFixtures.find((c) => c.id === newCaseId);
    expect(createdCase?.timeOfDeath).toBe('14:30');
  });
});

describe('NewCaseModal — initial case note', () => {
  it('does not call caseLogService.create when the note is left blank', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(caseLogService.create).not.toHaveBeenCalled();
  });

  it('does not call caseLogService.create when the note is only whitespace', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '   \n  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(caseLogService.create).not.toHaveBeenCalled();
  });

  it('saves a non-blank note through caseLogService with the new caseId, trusted organizationId, and session author — preserving internal line breaks, trimming only the outer whitespace', async () => {
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    const noteText = '  Family requested a biodegradable urn.\nMail death certificate to next of kin.  ';
    fireEvent.change(container.querySelector('textarea')!, { target: { value: noteText } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(caseLogService.create).toHaveBeenCalled());

    const [orgContext, caseId, input] = vi.mocked(caseLogService.create).mock.calls[0];
    expect(orgContext.organizationId).toBe(DEFAULT_ORGANIZATION_ID);
    expect(typeof caseId).toBe('string');
    expect(caseId.length).toBeGreaterThan(0);
    expect(input).toEqual({
      type: 'note',
      text: 'Family requested a biodegradable urn.\nMail death certificate to next of kin.',
      author: staffFixtures[0].displayName,
    });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/cases/${caseId}`));
  });
});

describe('NewCaseModal — partial-failure handling when the note fails to save', () => {
  it('shows a partial-success message, keeps the note text, and does not navigate away automatically', async () => {
    vi.mocked(caseLogService.create).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/case created successfully.*couldn't save your note/i);
    expect(container.querySelector('textarea')).toHaveValue('Important note');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('"Retry saving note" re-attempts only the note, never re-creates the case, and navigates once it succeeds', async () => {
    vi.mocked(caseLogService.create).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await screen.findByRole('alert');

    const callsBeforeRetry = vi.mocked(caseLogService.create).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving note' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(vi.mocked(caseLogService.create).mock.calls.length).toBe(callsBeforeRetry + 1);
    // Same caseId on both the failed attempt and the retry — proof no second case was created.
    const firstCaseId = vi.mocked(caseLogService.create).mock.calls[0][1];
    const retryCaseId = vi.mocked(caseLogService.create).mock.calls[1][1];
    expect(retryCaseId).toBe(firstCaseId);
  });

  it('"Continue without note" navigates to the created case without retrying the note', async () => {
    vi.mocked(caseLogService.create).mockRejectedValueOnce(new Error('network error'));
    const { container } = await renderModalWithFields();
    fillRequiredFields(container);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Important note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await screen.findByRole('alert');

    const callsBeforeContinue = vi.mocked(caseLogService.create).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Continue without note' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(vi.mocked(caseLogService.create).mock.calls.length).toBe(callsBeforeContinue);
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
    // with a role-based query.
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(2));
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
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(2));
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
      json: async () => ({
        workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID),
      }),
    });
    await waitFor(() => expect(container.querySelectorAll('input').length).toBe(14));
  });
});
