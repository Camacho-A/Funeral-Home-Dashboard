import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Phase 37 (Product Variants — ADR-041) structural boundaries — grep-based
 * invariants that keep the variant subsystem's sole-writer / sole-authority
 * discipline from silently eroding.
 */
const ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}
const ALL_FILES = walk(join(ROOT, 'services')).concat(walk(join(ROOT, 'app'))).concat(walk(join(ROOT, 'lib')));
function read(f: string): string { return readFileSync(f, 'utf8'); }
function stripComments(src: string): string { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); }

describe('Phase 37 structural boundaries', () => {
  it('merchandiseProductVariants is written ONLY by merchandiseVariantService', () => {
    const offenders = ALL_FILES.filter((f) => {
      if (f.endsWith('services/merchandiseVariantService.ts')) return false;
      if (f.endsWith('lib/wixMerchandiseProductVariantMapper.ts')) return false;
      const src = stripComments(read(f));
      return /insertWixDataItem\s*[<(][^)]*['"]merchandiseProductVariants['"]/.test(src) || /updateWixDataItem\s*[<(][^)]*['"]merchandiseProductVariants['"]/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('the hasVariants mode flag is flipped ONLY through merchandiseVariantService (setProductHasVariants imported nowhere else)', () => {
    const importers = ALL_FILES.filter((f) => {
      if (f.endsWith('services/merchandiseService.ts')) return false; // defines it
      if (f.endsWith('services/merchandiseVariantService.ts')) return false; // the sole authority
      return /\bsetProductHasVariants\b/.test(stripComments(read(f)));
    });
    expect(importers).toEqual([]);
  });

  it('no /api/family/* route or portal DTO exposes cost / supplier on a variant surface', () => {
    const familyAndPortal = ALL_FILES.filter((f) => /app\/api\/family\//.test(f) || /domain\/portal\//.test(f) || /services\/portal\//.test(f));
    const offenders = familyAndPortal.filter((f) => {
      const src = stripComments(read(f));
      return /\bcostOverride\b/.test(src) || /\bsupplierIdOverride\b/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
