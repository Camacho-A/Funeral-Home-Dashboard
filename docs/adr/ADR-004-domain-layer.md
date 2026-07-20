# ADR-004: Domain Layer

**Status:** Accepted
**Date:** 2026-07-20

## Context

The original prototype (`design/support.js`) encodes real, regulated funeral-home business rules — stage sequencing, checklist item locking, SLA targets and overdue calculation, the veteran/VA notification workflow, report aggregation — directly inside a single UI component's render logic (`buildCase()` and `renderVals()`). `docs/BUSINESS_RULES.md` already extracted and transcribed these rules from that script, with an explicit caveat that they need client confirmation since they were inferred from code rather than written directly by the client. Placing the equivalent logic inside React components, or inside a generic `utils/` folder, in the rebuild would blur the line between "how the business actually works" and "how it happens to be presented," making the rules hard to locate, hard to unit test independent of rendering, and hard to keep correct as the client corrects individual rules over time.

## Decision

Introduce a top-level `domain/` directory (`domain/cases/`, `domain/tasks/`, `domain/reports/`) holding every funeral-home business rule as plain, framework-independent TypeScript — no React, no data fetching, no presentation concerns. `utils/` is reserved strictly for generic, domain-independent helpers (date/phone formatting, print-window mechanics). Components and hooks call into `domain/` rather than reimplementing rules inline — e.g. `useCaseViewModel` is a thin, memoizing hook wrapper around `domain/cases/viewModel.ts`, not the derivation logic itself; Reports page components read from `domain/reports/calculations.ts` rather than computing aggregates ad hoc in the component tree.

## Consequences

- Business rules become unit-testable in complete isolation from rendering — the Frontend Engineering Plan's testing strategy leans on this directly (stage transitions, SLA calculations, checklist locking, veteran/VA logic, and report calculations are all pure-function unit tests).
- A rule correction from the client (e.g. a different SLA target, a changed checklist item) becomes a one-file change inside `domain/`, not a hunt through component JSX.
- Business rules live in one predictable location that maps one-to-one onto `docs/BUSINESS_RULES.md`, keeping the documentation and the implementation in sync by construction rather than by discipline alone.
- Adds one layer of indirection (component → hook → domain module) that a much smaller application might not need — justified here because Beacon already has meaningfully complex, regulated business logic that a future compliance or process review may need to inspect independent of the UI.

## Alternatives Considered

- **Keep business logic inline in components or hooks**: rejected — much harder to unit test in isolation, and harder to keep in sync as `docs/BUSINESS_RULES.md` rules are corrected by the client over time.
- **Put business logic inside `utils/` alongside generic helpers**: rejected per explicit client direction — conflates domain-specific policy (which stage is the SLA bottleneck, how checklist locking works) with domain-independent helpers (date formatting, printing), making it unclear which `utils/` functions would be safe to reuse in an unrelated future project versus which encode funeral-home-specific rules.
