# ADR-003: Component-First Frontend Architecture

**Status:** Accepted
**Date:** 2026-07-20

## Context

The approved design (`design/Beacon.dc.html`) implements four screens that share a large number of visual and interaction patterns — cards, status badges, checklists with locking logic, buttons, row-cards for cases/tasks/documents — all catalogued in `docs/UI_COMPONENTS.md`. The common shortcut of building each page independently and extracting shared components afterward tends to produce inconsistent, drifting one-off implementations of what should be identical UI (arguably visible already in how much inline, repeated styling exists in the original prototype), and makes the eventual "extract a shared component" pass expensive and risky once it has to touch multiple already-shipped pages.

## Decision

Build the design-token layer and the full library of reusable UI primitives and feature components (Frontend Engineering Plan Phases 1 through 4) before any page is assembled (Phases 5 through 9). Every page is a composition of already-built, already-verified components — never fresh construction of a card, badge, or checklist item from scratch.

## Consequences

- Visual consistency is enforced structurally — one `Badge` component, one `Card` component, one `Checklist item` component — rather than relying on code review or convention to catch drift.
- Each component can be verified once (and optionally in isolation via Storybook, see the Frontend Engineering Plan's optional Phase 2.5) instead of being re-verified separately on every page that uses it.
- Later, larger pages (Case Detail, the most complex screen) assemble quickly because the Dashboard build already proved out the primitives and the data-fetching layer.
- Front-loads work before any full page is visibly "done," which can look like slower initial progress to a stakeholder watching for a finished screen — the tradeoff is accepted because the total cost of building-then-retrofitting is expected to be higher.
- Requires disciplined scoping up front (the build-now/deferred component table in `docs/UI_COMPONENTS.md` and the Frontend Engineering Plan) to avoid over-building components the four approved screens don't actually need.

## Alternatives Considered

- **Page-first development** (build the Dashboard end-to-end, then Case Detail, extracting shared components opportunistically as duplication is noticed): rejected because it was expected to reproduce the kind of duplicated, drifting inline styling already present in the original prototype, and because retrofitting shared components after multiple pages already exist in production is more expensive and riskier than building them first.
