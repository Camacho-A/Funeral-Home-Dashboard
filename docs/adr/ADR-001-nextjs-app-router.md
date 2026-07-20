# ADR-001: Next.js App Router

**Status:** Accepted
**Date:** 2026-07-20

## Context

Beacon's V1 frontend is a staff operations portal with four distinct screens (Dashboard, Case Detail, Tasks, Reports) plus a New Case modal, replacing the original design prototype's single client-side `view` switch with real, navigable URLs (`docs/UI_COMPONENTS.md`). The application needs conventions for shared layout (a persistent sidebar/top-bar shell), route-level loading and error states, and a clear place for authentication middleware to attach once Wix Members auth is wired up in a later phase (`docs/ARCHITECTURE.md`). It also needs to deploy cleanly to Vercel, which is already the assumed hosting target (`docs/ARCHITECTURE.md`).

## Decision

Build Beacon as a Next.js application using the **App Router** (not the Pages Router), with TypeScript throughout, using Server Components by default and opting into Client Components only where interactivity requires it (forms, checklists, modals, filters).

## Consequences

- File-based routing under `app/` maps directly onto the four-screen information architecture, with a `(portal)` route group reserved as the future home of session/role middleware without restructuring routes later.
- Built-in per-route conventions (`error.tsx`, `not-found.tsx`, `loading.tsx`) give Beacon a consistent error/loading story for free, rather than a hand-rolled one (see the Frontend Engineering Plan's Phase 0).
- Nested layouts (`app/layout.tsx` → `app/(portal)/layout.tsx`) let the shared AppShell (sidebar + top bar) wrap every screen without prop drilling or a custom layout abstraction.
- Server Components reduce the client bundle for largely-static chrome, while interactive pieces opt in explicitly — this requires the team to understand the server/client component boundary, which is a real (if manageable) learning curve for anyone coming from a Pages Router or plain SPA background.
- Aligns with the Vercel-native deployment story already assumed in `docs/ARCHITECTURE.md`, with no separate routing/hosting decision needed.

## Alternatives Considered

- **Pages Router**: more ecosystem maturity and simpler mental model, but no native layouts, no built-in per-route loading/error conventions, and it's not Next.js's current recommended direction — would mean building several of the App Router's free conventions by hand.
- **A plain Vite + React Router single-page app**: simpler in isolation, but loses Next.js's Vercel-native deployment story and file-based routing already assumed elsewhere in the project's documentation, and would require re-introducing routing, loading, and error conventions manually rather than getting them from the framework.
