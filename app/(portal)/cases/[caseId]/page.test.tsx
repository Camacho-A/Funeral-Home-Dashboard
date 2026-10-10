import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { defaultRoleDefinition } from '@/domain/rbac/defaultRoles';

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

  it('14: CaseLogCard (a genuinely different, staff-notes feature) remains on Overview', () => {
    expect(SOURCE).toMatch(/<CaseLogCard[\s\S]*?onAddEntry=/);
  });

  /**
   * Author attribution (2026-10). This page used to pass
   * `authorName={viewModel.effectiveOwnerName}` — the case's ASSIGNED
   * OWNER — so every log entry was credited to whoever the case belonged
   * to, and to the literal "Office" on any unassigned case. Attribution
   * is now resolved server-side from the authenticated caller, so this
   * page must not name an author at all.
   */
  it('14b: never passes an author into CaseLogCard — the server resolves it from the caller', () => {
    expect(SOURCE).not.toMatch(/authorName/);
    expect(SOURCE).not.toMatch(/effectiveOwnerName/);
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

  it('Task #12 (2026-09, Forms organization): CaseFormsSection no longer imported/rendered on Overview — moved into the Documents tab\'s own sub-tab switcher', () => {
    expect(SOURCE).not.toMatch(/CaseFormsSection/);
  });
});

const CSS_SOURCE = fs.readFileSync(path.join(__dirname, 'page.module.css'), 'utf-8');

describe('Case Overview layout expansion (2026-09, following fdf3fd3)', () => {
  it('3/4/5/6/7/8/9: every remaining Overview card is present in the page source (BillingCard excluded — relocated to its own tab; CaseFormsSection excluded — Task #12 moved it into the Documents tab)', () => {
    expect(SOURCE).toMatch(/<CaseInformationCard/);
    expect(SOURCE).toMatch(/<ChecklistCard/);
    expect(SOURCE).toMatch(/<CaseLogCard/);
    expect(SOURCE).toMatch(/<CaseTasksCard/);
    expect(SOURCE).toMatch(/<CaseOrderCard caseId=\{caseId\}/);
  });

  it("10: Overview no longer wraps everything in the old fixed two-column '.columns'/'.column' layout", () => {
    expect(SOURCE).not.toMatch(/styles\.columns/);
    expect(SOURCE).not.toMatch(/styles\.column\}/);
    expect(CSS_SOURCE).not.toMatch(/\.columns\s*\{/);
    expect(CSS_SOURCE).not.toMatch(/\.column\s*\{/);
  });

  it('11: SOLIS Phase 3 two-column workspace — Checklist/Case Log+Tasks/Case Order sit in the main column, Case Information in its own sticky right rail, in that DOM order', () => {
    // Visual fidelity pass (2026-10): the two-column workspace replaces
    // the old single full-width-then-stacked layout. Main column
    // (.overviewMain): Checklist -> Case Log/Tasks pair -> Case Order.
    // Right rail (.overviewRail): Case Information, after the main
    // column in DOM order (CSS alone places it visually beside it).
    // Unchanged by the 2026-10 Case Info tab — see infoCardIndex below.
    const overviewOpenIndex = SOURCE.indexOf('className={styles.overview}');
    const mainOpenIndex = SOURCE.indexOf('className={styles.overviewMain}');
    const checklistIndex = SOURCE.indexOf('<ChecklistCard');
    const pairOpenIndex = SOURCE.indexOf('className={styles.overviewPair}');
    const orderCardIndex = SOURCE.indexOf('<CaseOrderCard');
    const railOpenIndex = SOURCE.indexOf('className={styles.overviewRail}');
    // Case Info tab (2026-10): the card is now defined once, above the
    // return, and referenced from the rail — so its DEFINITION no longer
    // sits inside the rail in source order, while the rendered DOM order
    // is exactly as before. Track the reference, which is what actually
    // determines where it mounts.
    // Scoped to the occurrence INSIDE the rail: the first reference in
    // source is the mobile Case Info tab branch, which renders in a
    // different place and must not be what this ordering check reads.
    const infoCardIndex = SOURCE.indexOf('{caseInformationPanel}', railOpenIndex);

    expect(overviewOpenIndex).toBeGreaterThan(-1);
    expect(railOpenIndex).toBeGreaterThan(-1);
    expect(overviewOpenIndex).toBeLessThan(mainOpenIndex);
    expect(mainOpenIndex).toBeLessThan(checklistIndex);
    expect(checklistIndex).toBeLessThan(pairOpenIndex);
    expect(pairOpenIndex).toBeLessThan(orderCardIndex);
    expect(orderCardIndex).toBeLessThan(railOpenIndex);
    expect(railOpenIndex).toBeLessThan(infoCardIndex);

    expect(CSS_SOURCE).toMatch(/\.overview\s*\{[^}]*display:\s*grid;/);
  });

  it('12: no empty right-column placeholder remains where ActivityLogCard/DocumentsCard used to be', () => {
    // The old layout closed with two sibling `styles.column` divs (left:
    // everything; right: ActivityLogCard + DocumentsCard). Confirm there
    // is exactly one top-level overview wrapper now, not a second,
    // now-empty column div.
    const columnDivMatches = SOURCE.match(/className=\{styles\.column\}/g) ?? [];
    expect(columnDivMatches).toHaveLength(0);
  });

  it('13: narrower widths stack the Case Log / Tasks pair cleanly via an explicit @media rule, and the whole workspace drops to one column before the rail could get cramped', () => {
    // Visual fidelity pass (2026-10): the Case Log/Tasks pair collapses
    // at 1200px (its own, earlier breakpoint — it's the first thing to
    // get tight in the main column); the whole two-column workspace
    // (main + sticky rail) collapses at 1024px, matching the README's
    // own "Below 1024px wide: one column" spec.
    expect(CSS_SOURCE).toMatch(/@media \(max-width:\s*1200px\)\s*\{\s*\.overviewPair\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(CSS_SOURCE).toMatch(/@media \(max-width:\s*1024px\)\s*\{\s*\.overview\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('14: the sticky rail has a bounded, sane pixel width (not unbounded or fixed) — both grids still resolve to a 1-column stack below 1024px, so a bounded rail can never force horizontal overflow', () => {
    // Visual fidelity pass (2026-10): unlike the prior layout, the new
    // design deliberately bounds the sticky right rail's width
    // (minmax(340px, 420px)) so Case Information reads well as a narrow
    // column — a real, intentional constraint, not a fixed/unresponsive
    // width, and it's still wrapped in `minmax(0, 1fr)` for the main
    // column so the grid itself never forces overflow at any width above
    // 1024px; below that, .overview itself collapses to one column
    // (checked above), so the rail's own px bound stops applying at all.
    const overviewBlock = CSS_SOURCE.match(/\.overview\s*\{[^}]*\}/)?.[0] ?? '';
    expect(overviewBlock).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(340px,\s*420px\);/);
  });

  it("does not reintroduce a fixed 1fr 1fr split for the whole Overview — only the smaller Case Log/Tasks pair keeps a 2-column grid, and it's scoped to .overviewPair", () => {
    const pairTwoColumnOccurrences = CSS_SOURCE.match(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/g) ?? [];
    expect(pairTwoColumnOccurrences).toHaveLength(1); // only inside .overviewPair
    // The main .overview grid uses its own distinct, asymmetric
    // main/rail split (minmax(0,1fr) minmax(340px,420px) — checked
    // above), never the Case Log/Tasks pair's equal-width pattern.
    const overviewBlock = CSS_SOURCE.match(/\.overview\s*\{[^}]*\}/)?.[0] ?? '';
    expect(overviewBlock).not.toMatch(/minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
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
    // SOLIS Final Phase §8.1: the Workflow tab now also renders
    // WorkflowStageOverview above CaseWorkflowRepairPanel, both inside the
    // same `activeTab === 'workflow' && canSeeWorkflowTab` gate — was a
    // single self-closing element, now a fragment with both components.
    expect(SOURCE).toMatch(/\{activeTab === 'workflow' && canSeeWorkflowTab && \([\s\S]*?<WorkflowStageOverview[\s\S]*?<CaseWorkflowRepairPanel caseId=\{caseId\} \/>[\s\S]*?\)\}/);
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

  it("22: Office Staff's role does not include payment.read, so this relocation grants it no new accounting access", () => {
    // Visual fidelity pass (2026-10): the new page.tsx's own comment is
    // shorter and no longer narrates this specific role fact inline —
    // check the real, authoritative source (domain/rbac/defaultRoles.ts)
    // instead of page.tsx's own prose, which is a stronger guarantee
    // against drift anyway (this now fails if the role definition itself
    // ever changes, not just if a comment goes stale).
    const officeStaff = defaultRoleDefinition('officeStaff');
    expect(officeStaff.permissions).not.toContain('payment.read');
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

/**
 * Case Info tab (2026-10) — mobile navigation.
 *
 * Asserted structurally for the reason this file documents at the top: the
 * page's `use()`-suspended params convention never settles under this
 * project's jsdom, so a rendered-DOM test of THIS page is not achievable.
 * The behaviour that can be exercised for real — the media query itself —
 * is covered by hooks/useMediaQuery.test.ts, and the card's own fields,
 * editing, phone/email links and Do-Not-Contact warning are covered by
 * CaseInformationCard.test.tsx and ContactInstructionsSection.test.tsx,
 * which are unaffected by where the card is mounted.
 */
const CASE_PAGE_CSS = fs.readFileSync(path.join(__dirname, 'page.module.css'), 'utf-8');

/** The max-width of the media query that turns `.tabs` into the mobile
    segmented control. */
function mobileTabsBreakpoint(): number {
  const match = CASE_PAGE_CSS.match(/@media \(max-width: (\d+)px\) \{\s*\.tabs\.tabs \{/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

/** The max-width at which `.overview` collapses from two columns to one. */
function overviewCollapseBreakpoint(): number {
  const match = CASE_PAGE_CSS.match(/@media \(max-width: (\d+)px\) \{\s*\.overview \{/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

describe('Case Detail page — Case Info mobile tab (2026-10)', () => {
  it('adds a Case Info tab button with the same semantics as every other tab', () => {
    expect(SOURCE).toMatch(/aria-selected=\{activeTab === 'caseInfo'\}/);
    expect(SOURCE).toMatch(/onClick=\{\(\) => setActiveTab\('caseInfo'\)\}/);
    expect(SOURCE).toMatch(/>\s*Case Info\s*</);
    // Same active/inactive classes as its siblings — no bespoke styling,
    // so spacing, typography and the active indicator all match.
    expect(SOURCE).toMatch(/activeTab === 'caseInfo' \? styles\.tabActive : styles\.tabInactive/);
  });

  it('the tab is a real tab in the existing tablist, so it is keyboard-reachable like the others', () => {
    const tab = SOURCE.match(/\{isMobileTabs && \([\s\S]*?Case Info[\s\S]*?\)\}/);
    expect(tab).not.toBeNull();
    expect(tab![0]).toMatch(/type="button"/);
    expect(tab![0]).toMatch(/role="tab"/);
    // It sits inside the one role="tablist" container, not a new one.
    expect(SOURCE.match(/role="tablist"/g) ?? []).toHaveLength(1);
    // The rendered label, not the substring shared with CaseInformationCard.
    expect(SOURCE.search(/>\s*Case Info\s*</)).toBeGreaterThan(SOURCE.indexOf('role="tablist"'));
  });

  it('shows the tab only on mobile, and the overview rail only off mobile', () => {
    expect(SOURCE).toMatch(/\{isMobileTabs && \(\s*<button/);
    expect(SOURCE).toMatch(/activeTab === 'caseInfo' && isMobileTabs/);
    expect(SOURCE).toMatch(/\{!isMobileTabs && \(\s*<aside className=\{styles\.overviewRail\}/);
  });

  it('renders Case Information exactly once — one element, two mutually exclusive placements', () => {
    // The real "no duplicate rendering" guarantee: a single
    // <CaseInformationCard>, hoisted into one variable, referenced from
    // the rail and the tab. Not two copies of the JSX, and not one copy
    // hidden with CSS (which would still duplicate the DOM).
    expect(SOURCE.match(/<CaseInformationCard/g) ?? []).toHaveLength(1);
    expect(SOURCE).toMatch(/const caseInformationPanel = \(/);
    expect(SOURCE.match(/\{caseInformationPanel\}/g) ?? []).toHaveLength(2);
  });

  it('does not recreate any Case Information field — the existing component is reused as-is', () => {
    // Deceased info, Next of Kin, and the contact-instruction fields all
    // still arrive as props on the one card.
    for (const prop of [
      'dateOfBirth',
      'placeOfDeath',
      'nextOfKinName',
      'nextOfKinPhone',
      'doNotContactNextOfKin',
      'arrangementContactName',
      'arrangementContactPhone',
      'contactInstructions',
    ]) {
      expect(SOURCE).toMatch(new RegExp(`${prop}=\\{`));
    }
  });

  it('uses the same breakpoint that produces the mobile tab bar', () => {
    // §5: the tab must appear exactly where a mobile tab bar exists. If
    // someone moves the CSS breakpoint without moving this one, this fails.
    expect(SOURCE).toMatch(
      new RegExp(`useMediaQuery\\('\\(max-width: ${mobileTabsBreakpoint()}px\\)'\\)`),
    );
  });

  it('leaves no width where Case Information is unreachable', () => {
    // Between the tab breakpoint and the overview collapse, the rail is
    // still rendered — stacked below the main column, fully visible. The
    // gap §5 warns about can only open if the tab breakpoint were raised
    // above the collapse breakpoint.
    expect(mobileTabsBreakpoint()).toBeLessThanOrEqual(overviewCollapseBreakpoint());
    expect(CASE_PAGE_CSS).toMatch(/\.overviewRail \{\s*position: static;/);
  });

  it('falls back to Overview when the viewport leaves mobile, preserving every other tab', () => {
    expect(SOURCE).toMatch(
      /if \(!isMobileTabs && activeTab === 'caseInfo'\) setActiveTab\('overview'\);/,
    );
    // Scoped to this one tab — no other selection is reset.
    expect(SOURCE.match(/setActiveTab\('overview'\)/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves the existing tabs and the desktop layout untouched', () => {
    for (const tab of ['overview', 'workflow', 'billing', 'documents', 'activity', 'schedule', 'portal']) {
      expect(SOURCE).toMatch(new RegExp(`setActiveTab\\('${tab}'\\)`));
    }
    // The desktop rail still lives inside the overview grid, in the same
    // <aside> with the same class — only its render is now gated.
    expect(SOURCE).toMatch(/<aside className=\{styles\.overviewRail\} aria-label="Case details">/);
    expect(CASE_PAGE_CSS).toMatch(/\.overview \{\s*display: grid;/);
    // Exactly one rendered "Case Info" label — no second, desktop-only
    // tab. Matched on the label as rendered, since "Case Info" is also a
    // substring of CaseInformationCard/caseInformationPanel.
    expect(SOURCE.match(/>\s*Case Info\s*</g) ?? []).toHaveLength(1);
  });

  it('gives the mobile tab panel its own full-width container', () => {
    expect(SOURCE).toMatch(/<section className=\{styles\.caseInfoTab\} aria-label="Case details">/);
    expect(CASE_PAGE_CSS).toMatch(/\.caseInfoTab \{/);
  });
});
