# Architecture Decision Records (ADR)

This folder holds Beacon's formal Architecture Decision Records — one file per significant technical or architectural decision, starting with the frontend engineering phase.

## What an ADR Is

An ADR is a short, standalone document that captures a single architecture decision: the situation that forced the decision, what was decided, what it costs and what it buys, and — where relevant — what else was considered and why it wasn't chosen. The goal is that a future contributor (or a future version of the team) can understand *why* the codebase is shaped the way it is without reverse-engineering it from code, commit messages, or chat history.

An ADR is a record of a decision, not a design document, a spec, or a how-to guide. It doesn't need to be updated as implementation details evolve — if the decision itself changes, a new ADR supersedes the old one (see below) rather than editing history.

## When to Create a New ADR

Create one when a decision:

- Is genuinely hard or expensive to reverse once acted on (a data model shape, a framework choice, a cross-cutting convention like tenant scoping).
- Affects more than one part of the system, or constrains how future work has to be done.
- Involved a real tradeoff between at least one viable alternative — if there was only ever one sane option, it's probably not worth an ADR.
- Is the kind of thing a new contributor would reasonably ask "wait, why is it built this way?" about.

Don't create one for routine implementation details, naming of a single function, or anything already fully explained by the code itself or by `docs/BUSINESS_RULES.md`/`docs/UI_COMPONENTS.md`.

## Numbering Convention

ADRs are numbered sequentially: `ADR-001`, `ADR-002`, `ADR-003`, and so on, zero-padded to three digits. **Numbers are never reused, even if an ADR is later rejected or superseded.** If a decision is reversed, write a *new* ADR that explicitly supersedes the old one (set the old ADR's Status to `Superseded by ADR-NNN` rather than deleting or renumbering it).

File naming: `ADR-NNN-kebab-case-title.md` (e.g. `ADR-001-nextjs-app-router.md`).

## Standard Template

```markdown
# ADR-NNN: <Title>

**Status:** Accepted | Proposed | Superseded by ADR-NNN
**Date:** YYYY-MM-DD

## Context

What situation, constraint, or forces made this decision necessary. What was true before the decision that made a choice unavoidable.

## Decision

What was actually decided, stated plainly and concretely.

## Consequences

What this makes easier, what it makes harder, and any obligations it creates going forward — both the benefits and the real costs.

## Alternatives Considered

Other options that were weighed and why they weren't chosen. Omit this section if there genuinely wasn't a viable alternative.
```

## Relationship to `docs/DECISIONS.md`

`docs/DECISIONS.md` is the lightweight decision log created during the project-scaffolding phase, covering the initial product/backend architecture decisions (the Wix Headless + Postgres compliance-service split, tenant isolation at the schema level, the Wix Members auth approach, and treating the exported design files as immutable). It predates this folder and uses its own `ADR-001`–`ADR-004` numbering.

**Going forward, `docs/adr/` is the formal ADR system for the project** — every new architectural decision (frontend or backend) should get a numbered file here rather than a new entry in `docs/DECISIONS.md`. The two logs currently have overlapping `ADR-NNN` numbers referring to different decisions (e.g. this folder's `ADR-002` — Multi-Tenant Architecture — is a distinct document from `docs/DECISIONS.md`'s `ADR-002` — Tenant Isolation via organizationId — even though they cover related ground). Whether to consolidate the two logs into one continuous numbering sequence, or keep them deliberately separate (`docs/DECISIONS.md` for the initial product/backend decisions, `docs/adr/` for everything from the frontend engineering phase onward), is an open question for the client to weigh in on — not resolved by this document.

## Index

| ADR | Title |
|---|---|
| [ADR-001](./ADR-001-nextjs-app-router.md) | Next.js App Router |
| [ADR-002](./ADR-002-multi-tenant-architecture.md) | Multi-Tenant Architecture |
| [ADR-003](./ADR-003-component-first-frontend-architecture.md) | Component-First Frontend Architecture |
| [ADR-004](./ADR-004-domain-layer.md) | Domain Layer |
| [ADR-005](./ADR-005-tanstack-query.md) | TanStack Query |
