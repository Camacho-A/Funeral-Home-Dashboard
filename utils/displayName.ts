/**
 * SOLIS Cases page — visual fidelity pass (2026-10). Thin re-export of the
 * Phase 1 Dashboard's own presentation-only title-case helper
 * (utils/string.ts#toDisplayTitleCase, already tested and in production
 * use on NeedsAttentionPanel/CasesByStagePanel) under the name/path this
 * page's own code expects — a single source of truth for "how a stored
 * name renders," not a second, duplicate normalization implementation.
 */
export { toDisplayTitleCase as toDisplayName } from './string';
