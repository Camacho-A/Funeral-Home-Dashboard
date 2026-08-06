import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 29 (Family Portal & External Collaboration). The structural tests
 * promised throughout this phase's implementation, gathered in one file
 * for the closeout task: "no duplicated provider logic," "only the
 * designated service writes to each new collection," and "no family
 * route imports a raw internal domain type directly" — mirroring
 * `services/notificationService.test.ts`'s own "orchestration boundary
 * (structural)" describe block's exact patterns.
 */
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
const allFiles = walk(root);

describe('Portal collection writers (structural)', () => {
  const writers: Record<string, string> = {
    portalUsers: join(__dirname, 'portalUserService.ts'),
    portalInvitations: join(__dirname, 'portalInvitationService.ts'),
    portalAccess: join(__dirname, 'portalAccessService.ts'),
    portalSessions: join(__dirname, 'portalSessionService.ts'),
    portalMessages: join(__dirname, 'portalMessagingService.ts'),
  };

  for (const [collection, writerPath] of Object.entries(writers)) {
    it(`only ${writerPath.split(sep).pop()} writes to "${collection}" directly`, () => {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((filePath) => filePath !== writerPath && writePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Portal provider/business-logic boundaries (structural)', () => {
  it('portalPaymentService.ts never imports a payment provider directly', () => {
    const filePath = join(__dirname, 'portalPaymentService.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(/from ['"][^'"]*clover\/cloverProvider['"]/.test(content)).toBe(false);
  });

  it('portalDocumentService.ts never imports a storage or PDF-rendering provider directly', () => {
    const filePath = join(__dirname, 'portalDocumentService.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(/from ['"][^'"]*vercelBlob\/vercelBlobStorageProvider['"]/.test(content)).toBe(false);
    expect(/from ['"][^'"]*puppeteerDocumentRenderer['"]/.test(content)).toBe(false);
  });

  it('no portal file duplicates signatureService.ts\'s completeSignatureRequest/declineSignatureRequest logic', () => {
    // portalSignatureService.ts must call the real functions, never
    // reimplement checksum/lock/status-transition logic of its own.
    const filePath = join(__dirname, 'portalSignatureService.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(/^import\s*\{[^}]*\b(completeSignatureRequest|declineSignatureRequest)\b/m.test(content)).toBe(true);
    // A structural proxy for "never reimplemented": no portal file (other
    // than signatureService.ts itself) writes to signatureRecords, the
    // collection only a genuine, real signature completion may create.
    const writePattern = /(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\(\s*['"]signatureRecords['"]/;
    const signatureServicePath = join(root, 'services', 'signatureService.ts');
    const offenders = allFiles.filter((f) => f !== signatureServicePath && writePattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('Family-facing route DTO discipline (structural)', () => {
  const familyRouteFiles = allFiles.filter((filePath) => filePath.includes(`${sep}app${sep}api${sep}family${sep}`) && filePath.endsWith(`${sep}route.ts`));
  const forbiddenTypeImportPattern = /from ['"][^'"]*types\/(caseDocument|appointment|payment|signatureRequest|activityEvent|portalAccess|portalInvitation|portalUser)['"]/;

  it('found at least one family route file to check (sanity check on the walk itself)', () => {
    expect(familyRouteFiles.length).toBeGreaterThan(0);
  });

  it('no family route file imports a raw internal domain type directly', () => {
    const offenders = familyRouteFiles.filter((filePath) => forbiddenTypeImportPattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders, `route(s) importing a raw domain type directly: ${offenders.join(', ')}`).toEqual([]);
  });
});
