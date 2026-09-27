import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Item #2 (2026-09) — Case Detail page structural test.
 *
 * This page uses Next.js 15's Client Component `params: Promise<...>`
 * convention, unwrapped via React's `use()`. Confirmed (diagnostically,
 * not assumed) that this project's Vitest/jsdom test environment cannot
 * resolve a `use()`-suspended component at all — even the simplest
 * possible `use(Promise.resolve(...))` under a `<Suspense>` boundary
 * never settles here, with zero prior precedent anywhere in this
 * codebase for testing a page built this way. A full rendered-DOM test
 * is therefore not achievable without rearchitecting the page's own
 * params-handling convention, which is out of scope for this task.
 *
 * Every *component-level* fact this task cares about (Activity tab's real
 * data/Print/actor-formatting, Documents tab's real data/Print, CaseHeader
 * unchanged, StageStepper unchanged, the scroll-reset hook's own behavior)
 * is already independently, fully covered by dedicated component tests
 * (CaseActivityTab.test.tsx, CaseDocumentsTab.test.tsx,
 * useResetMainContentScrollOnChange.test.tsx). What's specific to *this*
 * file — which components this page's Overview branch actually imports
 * and renders — is instead proven deterministically against the page's
 * own source text, the same "structural" testing technique this codebase
 * already uses elsewhere for import-boundary invariants.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf-8');

describe('Case Detail page — Overview tab structure (item #2, 2026-09)', () => {
  it('1: no longer imports or renders the old ActivityLogCard', () => {
    expect(SOURCE).not.toMatch(/ActivityLogCard/);
  });

  it('2: no longer imports or renders the old (mock-only) DocumentsCard', () => {
    expect(SOURCE).not.toMatch(/DocumentsCard/);
  });

  it('2b: no longer imports the mock-only useCaseDocuments hook on Overview', () => {
    expect(SOURCE).not.toMatch(/useCaseDocuments/);
  });

  it('3/4: still imports and renders CaseActivityTab for the Activity tab', () => {
    expect(SOURCE).toMatch(/import \{ CaseActivityTab \} from '@\/components\/case\/CaseActivityTab';/);
    expect(SOURCE).toMatch(/activeTab === 'activity'[\s\S]*?<CaseActivityTab/);
  });

  it('9/10: still imports and renders CaseDocumentsTab for the Documents tab', () => {
    expect(SOURCE).toMatch(/import \{ CaseDocumentsTab \} from '@\/components\/case\/CaseDocumentsTab';/);
    expect(SOURCE).toMatch(/activeTab === 'documents'[\s\S]*?<CaseDocumentsTab/);
  });

  it("6/11: passes caseName/caseNumber into both tabs (so each tab's own Print action can build a correct printed header)", () => {
    expect(SOURCE).toMatch(/<CaseActivityTab caseId=\{caseId\} caseName=\{viewModel\.decedentName\} caseNumber=\{viewModel\.caseNumber\} \/>/);
    expect(SOURCE).toMatch(/<CaseDocumentsTab caseId=\{caseId\} caseName=\{viewModel\.decedentName\} caseNumber=\{viewModel\.caseNumber\} \/>/);
  });

  it('14: CaseLogCard (a genuinely different, staff-notes feature) remains on Overview, untouched', () => {
    expect(SOURCE).toMatch(/<CaseLogCard[\s\S]*?authorName=\{viewModel\.effectiveOwnerName\}/);
  });

  it('15: CaseHeader and StageStepper remain, both still rendered outside/above the tab bar', () => {
    const headerIndex = SOURCE.indexOf('<CaseHeader');
    const stepperIndex = SOURCE.indexOf('<StageStepper');
    const tabsIndex = SOURCE.indexOf('role="tablist"');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(stepperIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(tabsIndex);
    expect(stepperIndex).toBeLessThan(tabsIndex);
  });

  it('16: the 688749f case-open scroll-reset hook is still called, keyed on caseId', () => {
    expect(SOURCE).toMatch(/useResetMainContentScrollOnChange\(caseId\);/);
  });

  it("Forms and Billing are NOT moved — CaseFormsSection/BillingCard remain on Overview, unconditional on activeTab === 'overview'", () => {
    expect(SOURCE).toMatch(/<CaseFormsSection caseId=\{caseId\} \/>/);
    expect(SOURCE).toMatch(/<BillingCard caseId=\{caseId\} \/>/);
  });
});
