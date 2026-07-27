/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Pure slug
 * normalization/validation — no I/O, no organizationId, no uniqueness
 * check (that requires querying existing organizations, so it lives in
 * services/organizationProvisioningService.ts's `generateUniqueSlug`,
 * which calls `normalizeSlugCandidate`/`isReservedSlug` from here).
 */

const MAX_SLUG_LENGTH = 60;

/** Every value here would collide with a real top-level route this
    application already serves (`/api/*`, `/login`, `/admin`-adjacent
    concepts) or a name the phase's own spec explicitly reserved — never
    assignable as an organization slug, even if otherwise available. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'login',
  'payments',
  'settings',
  'support',
  'beacon',
  'onboarding',
  'dashboard',
  'cases',
  'tasks',
  'reports',
  'static',
  'public',
  'www',
  'app',
]);

/**
 * Lowercases, replaces every run of non-`[a-z0-9]` characters with a
 * single hyphen, strips leading/trailing hyphens, and truncates to
 * `MAX_SLUG_LENGTH`. Never throws — an input that normalizes to nothing
 * (e.g. all-punctuation) falls back to `'organization'`, which the
 * caller's uniqueness check then disambiguates the same way any other
 * collision is handled (see generateUniqueSlug's own numbered-suffix
 * fallback).
 */
export function normalizeSlugCandidate(input: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    // Apostrophes (straight and curly) are dropped entirely, not treated
    // as a word separator — "Manor's Cremation" -> "manors-cremation",
    // matching the phase's own worked example, not "manor-s-cremation".
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return normalized.length > 0 ? normalized : 'organization';
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/** A syntactically valid slug shape — lowercase alphanumeric segments
    joined by single hyphens, no leading/trailing/doubled hyphens. Used to
    validate a slug a caller supplies directly (vs. one this module itself
    generated, which is always already in this shape). */
export function isValidSlugShape(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= MAX_SLUG_LENGTH;
}

/** Appends `-2`, `-3`, ... to a base slug for the caller's collision-retry
    loop — pure string math, the actual "does this collide" check is the
    caller's own I/O-backed responsibility. */
export function slugWithSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  return `${base}-${attempt}`;
}
