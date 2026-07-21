'use client';

import { createContext, useContext, useState } from 'react';

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
 */
type CaseSearchContextValue = {
  query: string;
  setQuery: (query: string) => void;
};

const CaseSearchContext = createContext<CaseSearchContextValue>({
  query: '',
  setQuery: () => {},
});

export function CaseSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  return (
    <CaseSearchContext.Provider value={{ query, setQuery }}>{children}</CaseSearchContext.Provider>
  );
}

export function useCaseSearch(): CaseSearchContextValue {
  return useContext(CaseSearchContext);
}
