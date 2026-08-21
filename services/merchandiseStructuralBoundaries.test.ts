import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Structural boundary tests
 * (ADR-039 §37), mirroring `services/calendarStructuralBoundaries.test.ts`'s
 * exact harness: sole-writer per new collection, sole-emitter per new
 * activity type, no inventory/merchandise business logic or direct Wix in
 * routes/UI, merchandise accounting posts ONLY through the ledger/pricing
 * services, PaymentService/ActivityService/NotificationService ownership is
 * unchanged, the ADR-034 layering invariant holds for the new types, and —
 * the security-critical one — no family-facing DTO exposes product `cost`.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) walk(fullPath, results);
    else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) results.push(fullPath);
  }
  return results;
}

const root = join(__dirname, '..');
const allFiles = walk(root);

describe('Merchandise/inventory collection writers (structural)', () => {
  const writers: Record<string, string> = {
    merchandiseProducts: join(__dirname, 'merchandiseService.ts'),
    inventoryMovements: join(__dirname, 'inventoryService.ts'),
    inventoryReservations: join(__dirname, 'inventoryService.ts'),
    inventoryBalances: join(__dirname, 'inventoryService.ts'),
    inventoryLocks: join(__dirname, 'inventoryLockService.ts'),
    inventoryWriteClaims: join(__dirname, 'inventoryLockService.ts'),
  };
  for (const [collection, writerPath] of Object.entries(writers)) {
    it(`only ${writerPath.split(sep).pop()} writes to "${collection}" directly`, () => {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem|deleteWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((f) => f !== writerPath && writePattern.test(readFileSync(f, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Merchandise/inventory activity-event emitter boundary (structural)', () => {
  const emitters: Record<string, string> = {
    MERCHANDISE_PRODUCT_CREATED: 'merchandiseService.ts',
    MERCHANDISE_PRODUCT_UPDATED: 'merchandiseService.ts',
    MERCHANDISE_PRODUCT_ARCHIVED: 'merchandiseService.ts',
    INVENTORY_RECEIVED: 'inventoryService.ts',
    INVENTORY_RESERVED: 'inventoryService.ts',
    INVENTORY_RELEASED: 'inventoryService.ts',
    INVENTORY_FULFILLED: 'inventoryService.ts',
    INVENTORY_RETURNED: 'inventoryService.ts',
    INVENTORY_TRANSFERRED: 'inventoryService.ts',
    INVENTORY_ADJUSTED: 'inventoryService.ts',
  };
  for (const [key, emitterFile] of Object.entries(emitters)) {
    it(`only activityService.ts and ${emitterFile} reference ACTIVITY_EVENT_TYPES.${key}`, () => {
      const pattern = new RegExp(`ACTIVITY_EVENT_TYPES\\.${key}\\b`);
      const allowed = new Set([join(__dirname, 'activityService.ts'), join(__dirname, emitterFile)]);
      const offenders = allFiles.filter((f) => !allowed.has(f) && pattern.test(readFileSync(f, 'utf8')));
      expect(offenders, `unexpected emitter(s) of ${key}: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('Merchandise accounting posts only through the ledger (structural)', () => {
  it('only ledger/pricing/inventory services call createAndPostJournalEntry — never a route or UI', () => {
    const pattern = /createAndPostJournalEntry\s*\(/;
    const offenders = allFiles.filter((f) => {
      const rel = f.slice(root.length + 1);
      const isSurface = rel.startsWith('app' + sep) || rel.startsWith('components' + sep) || rel.startsWith('hooks' + sep);
      return isSurface && pattern.test(readFileSync(f, 'utf8'));
    });
    expect(offenders, `a route/UI file posts a journal entry directly: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Merchandise/inventory routes + UI contain no direct Wix (structural)', () => {
  const surfaceFiles = allFiles.filter((f) => {
    const rel = f.slice(root.length + 1);
    return (
      rel.startsWith(join('app', 'api', 'merchandise')) ||
      rel.startsWith(join('app', 'api', 'inventory')) ||
      rel.includes(join('merchandise', 'route')) ||
      rel.startsWith(join('components', 'merchandise')) ||
      rel.startsWith(join('components', 'inventory')) ||
      rel === join('lib', 'merchandiseClient.ts') ||
      rel === join('lib', 'inventoryClient.ts') ||
      rel === join('hooks', 'useMerchandise.ts') ||
      rel === join('hooks', 'useInventory.ts')
    );
  });

  it('found merchandise/inventory surface files to check (sanity)', () => {
    expect(surfaceFiles.length).toBeGreaterThan(0);
  });

  it('no merchandise/inventory route/UI/client imports lib/wixDataApi or calls its functions directly', () => {
    const pattern = /from ['"][^'"]*wixDataApi['"]|(?:insertWixDataItem|updateWixDataItem|queryWixDataItems|deleteWixDataItem)\s*\(/;
    const offenders = surfaceFiles.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders, `direct Wix access in a surface file: ${offenders.join(', ')}`).toEqual([]);
  });
});

/** Strip line and block comments so the security check inspects real code,
    not the prose in a comment that legitimately explains "never cost". */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('Phase 35: no family-facing DTO exposes internal cost/margin (security, structural)', () => {
  it('no /api/family merchandise route or portal merchandise DTO references a `cost` field in code', () => {
    const familyFiles = allFiles.filter((f) => {
      const rel = f.slice(root.length + 1);
      return (
        rel === join('app', 'api', 'family', 'cases', '[caseId]', 'merchandise', 'route.ts') ||
        rel.includes(join('portal', 'portalMerchandise')) ||
        rel.includes('portalMerchandiseView')
      );
    });
    expect(familyFiles.length, 'expected to find the family merchandise surface files').toBeGreaterThan(0);
    // `.cost` (property access) or `cost:` (property key) in real code — a
    // family DTO must never carry either.
    const pattern = /\.cost\b|\bcost\s*:/;
    const offenders = familyFiles.filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders, `a family surface references cost in code: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Phase 35: hard layering invariant — new operational types (structural)', () => {
  const fileNames = ['merchandiseProduct.ts', 'inventoryMovement.ts', 'inventoryReservation.ts', 'inventoryBalance.ts'];
  for (const fileName of fileNames) {
    it(`${fileName} declares no forbidden *IdentityId field`, () => {
      const source = readFileSync(join(root, 'types', fileName), 'utf8');
      const fieldPattern = /^\s*(\w+)\??:\s*/gm;
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = fieldPattern.exec(source)) !== null) {
        if (match[1].endsWith('IdentityId')) offenders.push(match[1]);
      }
      expect(offenders).toEqual([]);
    });
  }
});
