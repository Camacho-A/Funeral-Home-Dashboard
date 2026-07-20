# ADR-005: TanStack Query

**Status:** Accepted
**Date:** 2026-07-20

## Context

Beacon's frontend needs to fetch, cache, and mutate server/domain data — cases, contacts, tasks, staff, documents — from `services/` functions that return mock fixtures today and will call Wix Headless/Postgres once the backend-integration phase begins (`docs/ARCHITECTURE.md`, `docs/API_SPEC.md`). The application does not have significant cross-cutting client-only state that would justify a global store: its state is either server/domain data, or UI state that's naturally scoped to a single screen (search text, which stage filter is active, a modal's open/closed state, an in-progress form draft) — see the Frontend Engineering Plan's State Management section.

## Decision

Use **TanStack Query** for all server/domain data fetching, caching, and mutation, with cache keys consistently including `organizationId` as the leading segment (e.g. `['cases', organizationId, filters]`, `['case', organizationId, caseId]`) per ADR-002. No global client-state library (Redux, Zustand, or similar) is introduced.

## Consequences

- One consistent data-fetching pattern spans this mock-data phase and the later real-backend phase — swapping a service function's implementation from a mock to a real Wix/Postgres call changes nothing about how components consume the data.
- Built-in caching, request de-duplication, and invalidation-on-mutation eliminate a large class of hand-rolled `useEffect`/`useState` data-fetching bugs (stale data, duplicate fetches, manual refetch-after-mutation logic).
- Including `organizationId` in every cache key structurally prevents cross-organization cache bleed once a second organization exists, directly reinforcing ADR-002 rather than depending on separate discipline to keep caches isolated.
- Introduces a dependency and a caching/invalidation mental model that anyone unfamiliar with TanStack Query needs to learn.
- Requires discipline to keep genuinely UI-only state (filters, in-progress drafts) out of the Query cache, where it doesn't belong and would complicate invalidation.

## Alternatives Considered

- **Redux or Zustand**: rejected — Beacon has no significant client-only global state need that isn't either server/domain data (better served by a query cache) or screen-local UI state (better served by plain `useState`/`useReducer`); adding a global store would be unjustified complexity for this application's actual state shape.
- **Plain `useEffect` + `useState` data fetching, hand-rolled**: rejected — no built-in caching, de-duplication, or invalidation, and it doesn't provide the clean seam TanStack Query gives for swapping mock services for real backend calls later without touching component code.
