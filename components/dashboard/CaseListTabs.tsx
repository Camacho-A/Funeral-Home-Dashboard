import { useRef, type KeyboardEvent } from 'react';
import styles from './CaseListTabs.module.css';

export type CaseListTabDef = {
  /** `null` is "All Cases" — the one non-stage tab (see Case list
      scalability, Phase 2/3: "All Cases" is a UI/query mode, never a
      persisted workflow stage). Every other key is an exact
      domain/cases/stages.ts#STAGES label — the same stable identifier
      GET /api/cases's own `stage` query param and GET /api/cases/counts's
      `byStage` keys already use, so no second id scheme is invented here. */
  key: string | null;
  label: string;
  /** `null` while counts are still loading — rendered as a bare label with
      no "(…)" suffix rather than a layout-shifting placeholder. */
  count: number | null;
};

/**
 * Case list scalability, Phase 3 (2026-09). The 8-tab bar (All Cases +
 * the 7 canonical STAGES) replacing the old vertical
 * AllCasesList/StageFilteredPanel toggle. Proper ARIA tabs semantics
 * (tablist/tab, aria-selected, aria-controls -> the panel's id) plus a
 * roving-tabindex Left/Right/Home/End keyboard pattern — the standard
 * WAI-ARIA Tabs interaction — implemented directly rather than pulling in
 * a UI library, since nothing in components/ui/ already provides it.
 *
 * Layout (2026-09): a single horizontally-scrollable flex row handles
 * both desktop (fits without scrolling in the common case, never wraps
 * into a multi-row block) and narrow widths (scrolls instead of shrinking
 * text or truncating labels) with one CSS treatment, rather than two
 * separate responsive implementations.
 */
export function CaseListTabs({
  tabs,
  activeTab,
  onSelectTab,
  panelId,
}: {
  tabs: CaseListTabDef[];
  activeTab: string | null;
  onSelectTab: (key: string | null) => void;
  /** The id of the tabpanel this tablist controls — a single shared panel
      area renders whichever tab's content is active, matching "only ONE
      case list should be visibly rendered at a time." */
  panelId: string;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function tabKey(key: string | null): string {
    return key ?? '__all__';
  }

  function focusTab(index: number) {
    const target = tabs[index];
    if (!target) return;
    tabRefs.current[tabKey(target.key)]?.focus();
    onSelectTab(target.key);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab((index + 1) % tabs.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab((index - 1 + tabs.length) % tabs.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div className={styles.scrollTrack} role="tablist" aria-label="Case list">
      {tabs.map((tab, index) => {
        const selected = activeTab === tab.key;
        const key = tabKey(tab.key);
        return (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`case-list-tab-${key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`${styles.tab} ${selected ? styles.tabSelected : ''}`}
            onClick={() => onSelectTab(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span className={styles.tabLabel}>{tab.label}</span>
            {tab.count !== null && <span className={styles.tabCount}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
