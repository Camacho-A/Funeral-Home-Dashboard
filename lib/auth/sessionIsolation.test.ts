import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from './sessionToken';
import { createFamilySessionToken, verifyFamilySessionToken } from './familySessionToken';

/**
 * Phase 29 (Family Portal & External Collaboration), refinement #4: staff
 * and family session/auth code must be structurally isolated, not merely
 * isolated by convention. These tests prove it two ways: cryptographically
 * (a token minted for one audience is never accepted by the other
 * verifier — cross-rejection is already exercised in depth in
 * lib/auth/familySessionToken.test.ts; the assertions here are a thin,
 * co-located confirmation, not a re-derivation) and structurally (no
 * family route imports a staff auth resolver, and no staff route imports
 * a family one — a source-tree walk, mirroring the established pattern in
 * services/notificationService.test.ts's own "orchestration boundary
 * (structural)" describe block).
 */
describe('session isolation (structural)', () => {
  it('a staff session token is never accepted by the family verifier', async () => {
    const staffToken = await createSessionToken({ id: 'identity-1', email: 'staff@example.com', displayName: 'Staff', source: 'mock' });
    expect(await verifyFamilySessionToken(staffToken)).toBeNull();
  });

  it('a family session token is never accepted by the staff verifier', async () => {
    const familyToken = await createFamilySessionToken({ portalUserId: 'portal-user-1', sessionId: 'session-1' });
    expect(await verifySessionToken(familyToken)).toBeNull();
  });

  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const root = join(__dirname, '..', '..');
  const allRouteFiles = walk(join(root, 'app', 'api')).filter((filePath) => filePath.endsWith(`${sep}route.ts`));
  const familyRouteFiles = allRouteFiles.filter((filePath) => filePath.includes(`${sep}api${sep}family${sep}`));
  const staffRouteFiles = allRouteFiles.filter((filePath) => !familyRouteFiles.includes(filePath));

  it('no family route imports a staff session/authorization resolver', () => {
    const forbiddenPattern = /^import .*from ['"][^'"]*lib\/auth\/(requireIdentitySession|requireAuthorizedOrganization)['"]/m;
    const offenders = familyRouteFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no staff route imports a family session/authorization resolver', () => {
    const forbiddenPattern = /^import .*from ['"][^'"]*lib\/auth\/(requireFamilySession|requireFamilyAccess)['"]/m;
    const offenders = staffRouteFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('found at least one family route and one staff route to check (sanity check on the walk itself)', () => {
    expect(familyRouteFiles.length).toBeGreaterThan(0);
    expect(staffRouteFiles.length).toBeGreaterThan(0);
  });

  /**
   * Phase 30 (Identity Model Hardening & Staff Assignment Unification):
   * reaffirms the same boundary for `services/staffProfileService.ts`'s
   * caller-resolution/assignment functions — a `PortalUser.id` structurally
   * cannot resolve against `StaffProfile.identityId`, so no family route
   * should ever import them.
   */
  it('no family route imports staffProfileService caller-resolution/assignment functions', () => {
    const forbiddenPattern = /^import .*from ['"][^'"]*services\/staffProfileService['"]/m;
    const offenders = familyRouteFiles.filter((filePath) => forbiddenPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
