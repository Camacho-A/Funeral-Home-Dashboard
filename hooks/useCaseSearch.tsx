'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Shared search-box state (Frontend Engineering Plan, Phase 5).
 *
 * The search input lives in the persistent TopBar (components/layout/TopBar.tsx,
 * rendered by the shared (portal) layout), but only the Dashboard's case list
 * actually reads it — matching the prototype, where the search box is always
 * visible but only meaningful on the Dashboard view. A layout can't receive
 * props from the page it wraps, so a small shared context is the standard,
 * idiomatic way to connect the two across that boundary without coupling
 * either side to the URL or to each other directly.
 *
 * This resolves the placeholder noted in TopBar.tsx during Phase 2
 * ("Phase 5 is expected to pass searchValue/onSearchChange...").
 *
 * Case list scalability, Phase 3 (2026-09): `debouncedQuery` is new.
 * `query`/`setQuery` are unchanged — TopBar's `<SearchInput value={query}
 * onChange={setQuery}>` still updates on every keystroke, so typing never
 * feels delayed. `debouncedQuery` only catches up SEARCH_DEBOUNCE_MS after
 * typing pauses; the Dashboard's server-side search (hooks/useCaseListPage.ts,
 * hooks/useCaseCounts.ts) reads `debouncedQuery`, not `query`, so a
 * paginated/counts request isn't fired on every single keystroke — see
 * those hooks' own comments for why that matters now that search is a real
 * server round-trip instead of a local array filter.
 */
const SEARCH_DEBOUNCE_MS = 300;

type CaseSearchContextValue = {
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
};

// Exported (only) so tests can render `<CaseSearchContext.Provider value={...}>`
// directly with a synchronous, no-debounce value — integration tests that
// need "a search term is active" as a precondition shouldn't also have to
// wait out the real SEARCH_DEBOUNCE_MS timer; the debounce mechanism
// itself has its own dedicated test (useCaseSearch.test.tsx).
export const CaseSearchContext = createContext<CaseSearchContextValue>({
  query: '',
  setQuery: () => {},
  debouncedQuery: '',
});

export function CaseSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <CaseSearchContext.Provider value={{ query, setQuery, debouncedQuery }}>{children}</CaseSearchContext.Provider>
  );
}

export function useCaseSearch(): CaseSearchContextValue {
  return useContext(CaseSearchContext);
}
