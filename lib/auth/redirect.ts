/**
 * The "validate redirects to prevent open-redirect vulnerabilities"
 * requirement, concretely: only ever allow a same-origin, relative path as
 * a post-login redirect target. Used by both the login page (rendering
 * the hidden `next` field) and its Server Action (after successful auth) —
 * so a crafted `?next=https://evil.example.com` (or `//evil.example.com`,
 * a protocol-relative URL) can never send an authenticated user off-site.
 */
export function sanitizeRedirectPath(path: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!path) return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return fallback;
  }
  return path;
}

/** Phase 29 (Family Portal & External Collaboration). The identical
    same-origin-only validation as `sanitizeRedirectPath` above, with a
    `/family/dashboard` fallback instead of the staff app's `/dashboard` —
    used by `/family/login`'s own post-login redirect (see
    `middleware.ts`'s `/family/*` branch, which sets the same `next` query
    param convention). */
export function sanitizeFamilyRedirectPath(path: string | null | undefined): string {
  const fallback = '/family/dashboard';
  if (!path) return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return fallback;
  }
  return path;
}
