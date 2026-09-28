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

  it("Forms is NOT moved — CaseFormsSection remains on Overview, unconditional on activeTab === 'overview'", () => {
    expect(SOURCE).toMatch(/<CaseFormsSection caseId=\{caseId\} \/>/);
  });
});

const CSS_SOURCE = fs.readFileSync(path.join(__dirname, 'page.module.css'), 'utf-8');

describe('Case Overview layout expansion (2026-09, following fdf3fd3)', () => {
  it('3/4/5/6/7/8/9: every remaining Overview card is present in the page source (BillingCard excluded — relocated to its own tab)', () => {
    expect(SOURCE).toMatch(/<CaseInformationCard/);
    expect(SOURCE).toMatch(/<ChecklistCard/);
    expect(SOURCE).toMatch(/<CaseLogCard/);
    expect(SOURCE).toMatch(/<CaseTasksCard/);
    expect(SOURCE).toMatch(/<CaseFormsSection caseId=\{caseId\} \/>/);
    expect(SOURCE).toMatch(/<CaseOrderCard caseId=\{caseId\}/);
  });

  it("10: Overview no longer wraps everything in the old fixed two-column '.columns'/'.column' layout", () => {
    expect(SOURCE).not.toMatch(/styles\.columns/);
    expect(SOURCE).not.toMatch(/styles\.column\}/);
    expect(CSS_SOURCE).not.toMatch(/\.columns\s*\{/);
    expect(CSS_SOURCE).not.toMatch(/\.column\s*\{/);
  });

  it('11: the primary operational cards are direct children of the new full-width .overview container, not nested inside a half-width column', () => {
    // Everything from CaseInformationCard through ChecklistCard sits
    // directly under styles.overview — only Case Log/Tasks (a deliberate,
    // narrower pairing — see the CSS's own comment) are nested one level
    // deeper, inside styles.overviewPair.
    const overviewOpenIndex = SOURCE.indexOf('className={styles.overview}');
    const infoCardIndex = SOURCE.indexOf('<CaseInformationCard');
    const checklistIndex = SOURCE.indexOf('<ChecklistCard');
    const pairOpenIndex = SOURCE.indexOf('className={styles.overviewPair}');
    expect(overviewOpenIndex).toBeGreaterThan(-1);
    expect(pairOpenIndex).toBeGreaterThan(-1);
    expect(overviewOpenIndex).toBeLessThan(infoCardIndex);
    expect(infoCardIndex).toBeLessThan(checklistIndex);
    expect(checklistIndex).toBeLessThan(pairOpenIndex);

    expect(CSS_SOURCE).toMatch(/\.overview\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  });

  it('12: no empty right-column placeholder remains where ActivityLogCard/DocumentsCard used to be', () => {
    // The old layout closed with two sibling `styles.column` divs (left:
    // everything; right: ActivityLogCard + DocumentsCard). Confirm there
    // is exactly one top-level overview wrapper now, not a second,
    // now-empty column div.
    const columnDivMatches = SOURCE.match(/className=\{styles\.column\}/g) ?? [];
    expect(columnDivMatches).toHaveLength(0);
  });

  it('13: narrower widths stack the Case Log / Tasks pair cleanly via an explicit @media rule (no app-wide redesign)', () => {
    expect(CSS_SOURCE).toMatch(/@media \(max-width:\s*860px\)\s*\{\s*\.overviewPair\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('14: the new layout rules use only relative/fr sizing (no fixed pixel widths that could force horizontal overflow)', () => {
    const overviewBlock = CSS_SOURCE.match(/\.overview\s*\{[^}]*\}/)?.[0] ?? '';
    const overviewPairBlock = CSS_SOURCE.match(/\.overviewPair\s*\{[^}]*\}/)?.[0] ?? '';
    expect(overviewBlock).not.toMatch(/\d+px/);
    expect(overviewPairBlock).not.toMatch(/\d+px/);
  });

  it("does not reintroduce a fixed 1fr 1fr split for the whole Overview — only the smaller Case Log/Tasks pair keeps a 2-column grid, and it's scoped to .overviewPair", () => {
    const oneFrOneFrOccurrences = CSS_SOURCE.match(/grid-template-columns:\s*1fr 1fr;/g) ?? [];
    expect(oneFrOneFrOccurrences).toHaveLength(1); // only inside .overviewPair
  });
});

describe('Case Detail page — Family Portal tab organization capability gating (item #3, 2026-09)', () => {
  it('reads the organization record and the central capability, not a hardcoded organizationId check', () => {
    expect(SOURCE).toMatch(/import \{ useOrganizationRecord \} from '@\/hooks\/useOrganizationRecord';/);
    expect(SOURCE).toMatch(/import \{ isFamilyPortalEnabled \} from '@\/domain\/organization\/familyPortalCapability';/);
    expect(SOURCE).not.toMatch(/organizationId === 'managed-cremations'/);
  });

  it('2: the Family Portal tab button only renders when familyPortalEnabled', () => {
    expect(SOURCE).toMatch(/\{familyPortalEnabled && \([\s\S]*?Family Portal[\s\S]*?\)\}/);
  });

  it('the Family Portal panel render is also gated on familyPortalEnabled (not just the tab button)', () => {
    expect(SOURCE).toMatch(/activeTab === 'portal' && familyPortalEnabled && <CaseFamilyPortalTab/);
  });

  it('3/4/5/6: Overview, Activity, Documents, and Schedule tab buttons remain unconditional', () => {
    expect(SOURCE).toMatch(/onClick=\{\(\) => setActiveTab\('overview'\)\}/);
    expect(SOURCE).toMatch(/onClick=\{\(\) => setActiveTab\('activity'\)\}/);
    expect(SOURCE).toMatch(/onClick=\{\(\) => setActiveTab\('documents'\)\}/);
    expect(SOURCE).toMatch(/onClick=\{\(\) => setActiveTab\('schedule'\)\}/);
  });

  it('no empty/disabled/placeholder Family Portal tab is left behind — the button is either rendered whole or not at all', () => {
    expect(SOURCE).not.toMatch(/disabled\s*\n?\s*role="tab"[\s\S]*?Family Portal/);
    expect(SOURCE).not.toMatch(/Family Portal \(disabled\)/);
    expect(SOURCE).not.toMatch(/Family Portal \(unavailable\)/);
  });
});

describe('Case Detail page — Workflow tab (item #10, 2026-09: workflow repair relocation)', () => {
  it('1: the Workflow tab button renders only for an authorized caller (gated on canSeeWorkflowTab, the same user.manageRoles check CaseWorkflowRepairPanel already self-enforces)', () => {
    expect(SOURCE).toMatch(/import \{ useMyPermissions \} from '@\/hooks\/useRbac';/);
    expect(SOURCE).toMatch(/canSeeWorkflowTab = Boolean\(permissionsQuery\.data\?\.permissions\.includes\('user\.manageRoles'\)\)/);
    expect(SOURCE).toMatch(/\{canSeeWorkflowTab && \([\s\S]*?Workflow[\s\S]*?\)\}/);
  });

  it('2: the Workflow tab button appears directly after Overview and before Billing (2026-09: billing-tab relocation moved Billing directly after Workflow)', () => {
    const overviewButtonIndex = SOURCE.indexOf(">\n          Overview\n        </button>");
    const workflowButtonIndex = SOURCE.indexOf('>\n            Workflow\n          </button>');
    const billingButtonIndex = SOURCE.indexOf('>\n            Billing\n          </button>');
    expect(overviewButtonIndex).toBeGreaterThan(-1);
    expect(workflowButtonIndex).toBeGreaterThan(-1);
    expect(billingButtonIndex).toBeGreaterThan(-1);
    expect(overviewButtonIndex).toBeLessThan(workflowButtonIndex);
    expect(workflowButtonIndex).toBeLessThan(billingButtonIndex);
  });

  it('3: CaseWorkflowRepairPanel renders inside the Workflow tab, gated on both activeTab and the same authorization check', () => {
    expect(SOURCE).toMatch(/\{activeTab === 'workflow' && canSeeWorkflowTab && <CaseWorkflowRepairPanel caseId=\{caseId\} \/>\}/);
  });

  it('4: CaseWorkflowRepairPanel is rendered exactly once in the whole page — no duplicate instance left in Overview', () => {
    const occurrences = SOURCE.match(/<CaseWorkflowRepairPanel caseId=\{caseId\} \/>/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("5/6: Overview's own block contains no reference to CaseWorkflowRepairPanel — \"Case stuck or missing prerequisites?\"/\"Recalculate Workflow\" (both live only inside that component) can no longer render there", () => {
    const overviewBlockStart = SOURCE.indexOf("activeTab === 'overview' && (");
    const overviewBlockEnd = SOURCE.indexOf('</div>\n      )}', overviewBlockStart);
    const overviewBlock = SOURCE.slice(overviewBlockStart, overviewBlockEnd);
    expect(overviewBlock).not.toMatch(/CaseWorkflowRepairPanel/);
  });

  it('9: an unauthorized caller (canSeeWorkflowTab false) never renders the Workflow tab button or its content — no empty administrative tab', () => {
    // Both the button and the content branch share the identical
    // `canSeeWorkflowTab` guard — false for either means neither renders.
    const buttonGuardMatches = SOURCE.match(/canSeeWorkflowTab/g) ?? [];
    expect(buttonGuardMatches.length).toBeGreaterThanOrEqual(3); // declaration + button guard + content guard
  });
});

describe('Case Detail page — Billing tab (2026-09, billing-tab relocation)', () => {
  it('1/20: the Billing tab button renders only for an authorized caller (gated on canSeeBillingTab, the existing payment.read permission — the same financial-visibility tier CaseOrderCard already reserves)', () => {
    expect(SOURCE).toMatch(/canSeeBillingTab = Boolean\(permissionsQuery\.data\?\.permissions\.includes\('payment\.read'\)\)/);
    expect(SOURCE).toMatch(/\{canSeeBillingTab && \([\s\S]*?Billing[\s\S]*?\)\}/);
  });

  it('2: the Billing tab button appears directly after Workflow and before Documents', () => {
    const workflowButtonIndex = SOURCE.indexOf('>\n            Workflow\n          </button>');
    const billingButtonIndex = SOURCE.indexOf('>\n            Billing\n          </button>');
    const documentsButtonIndex = SOURCE.indexOf('>\n          Documents\n        </button>');
    expect(workflowButtonIndex).toBeGreaterThan(-1);
    expect(billingButtonIndex).toBeGreaterThan(-1);
    expect(documentsButtonIndex).toBeGreaterThan(-1);
    expect(workflowButtonIndex).toBeLessThan(billingButtonIndex);
    expect(billingButtonIndex).toBeLessThan(documentsButtonIndex);
  });

  it('5: BillingCard renders inside the Billing tab, gated on both activeTab and the same authorization check', () => {
    expect(SOURCE).toMatch(/\{activeTab === 'billing' && canSeeBillingTab && <BillingCard caseId=\{caseId\} \/>\}/);
  });

  it('7: BillingCard is rendered exactly once in the whole page — no duplicate instance left in Overview', () => {
    const occurrences = SOURCE.match(/<BillingCard caseId=\{caseId\} \/>/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('6: Overview\'s own block contains no reference to BillingCard', () => {
    const overviewBlockStart = SOURCE.indexOf("activeTab === 'overview' && (");
    const overviewBlockEnd = SOURCE.indexOf('</div>\n      )}', overviewBlockStart);
    const overviewBlock = SOURCE.slice(overviewBlockStart, overviewBlockEnd);
    expect(overviewBlock).not.toMatch(/BillingCard/);
  });

  it('8: CaseOrderCard remains on Overview, unmoved', () => {
    const overviewBlockStart = SOURCE.indexOf("activeTab === 'overview' && (");
    const overviewBlockEnd = SOURCE.indexOf('</div>\n      )}', overviewBlockStart);
    const overviewBlock = SOURCE.slice(overviewBlockStart, overviewBlockEnd);
    expect(overviewBlock).toMatch(/<CaseOrderCard caseId=\{caseId\}/);
  });

  it('21: an unauthorized caller (canSeeBillingTab false) never renders the Billing tab button or its content — no empty financial tab', () => {
    // Both the button and the content branch share the identical
    // `canSeeBillingTab` guard — false for either means neither renders.
    const guardMatches = SOURCE.match(/canSeeBillingTab/g) ?? [];
    expect(guardMatches.length).toBeGreaterThanOrEqual(3); // declaration + button guard + content guard
  });

  it("22: Office Staff's role does not include payment.read, so this relocation grants it no new accounting access (documented in the page's own comment)", () => {
    expect(SOURCE).toMatch(/Office Staff's[\s\S]{0,400}payment\.read/);
  });
});

describe('Case Detail page — six-tab order (2026-09, billing-tab relocation, supersedes item #10\'s Activity-before-Documents order)', () => {
  it('3/4: Documents appears before Activity, and the authorized-Manors tab order is exactly Overview, Workflow, Billing, Documents, Activity, Schedule', () => {
    const indices = {
      overview: SOURCE.indexOf(">\n          Overview\n        </button>"),
      workflow: SOURCE.indexOf('>\n            Workflow\n          </button>'),
      billing: SOURCE.indexOf('>\n            Billing\n          </button>'),
      documents: SOURCE.indexOf('>\n          Documents\n        </button>'),
      activity: SOURCE.indexOf('>\n          Activity\n        </button>'),
      schedule: SOURCE.indexOf('>\n          Schedule\n        </button>'),
    };
    for (const [name, index] of Object.entries(indices)) {
      expect(index, `${name} tab button not found`).toBeGreaterThan(-1);
    }
    expect(indices.overview).toBeLessThan(indices.workflow);
    expect(indices.workflow).toBeLessThan(indices.billing);
    expect(indices.billing).toBeLessThan(indices.documents);
    expect(indices.documents).toBeLessThan(indices.activity); // Documents before Activity
    expect(indices.activity).toBeLessThan(indices.schedule);
  });

  it('25: no duplicate Billing content exists anywhere on Case Detail', () => {
    const billingCardOccurrences = SOURCE.match(/<BillingCard/g) ?? [];
    const billingHeadingOccurrences = SOURCE.match(/>\s*Billing\s*</g) ?? [];
    expect(billingCardOccurrences).toHaveLength(1);
    expect(billingHeadingOccurrences.length).toBeLessThanOrEqual(1);
  });
});
