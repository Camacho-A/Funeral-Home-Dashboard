import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { caseFixtures } from './__mocks__/fixtures';

/**
 * Server-side case loading (2026-10). `casesService.get` is a browser data
 * accessor: in wix mode it fetches a RELATIVE url, which throws on the
 * server. Four server paths used it to load a case for a notification, and
 * each swallowed the throw — so new-case, form, PDF, payment and document
 * notifications were silently never sent in production.
 */

vi.mock('./caseWriteService', () => ({
  loadCaseRow: vi.fn(async (organizationId: string, caseId: string) =>
    organizationId === 'managed-cremations' && caseId === 'case-live' ? { id: 'case-live', data: {}, case_: { id: 'case-live', organizationId } } : null,
  ),
}));

const { loadCaseOnServer } = await import('./serverCaseLoader');

describe('loadCaseOnServer', () => {
  it('mock mode reads the fixture for that organization only', async () => {
    const known = caseFixtures[0];
    expect((await loadCaseOnServer(known.organizationId, known.id, 'mock'))?.id).toBe(known.id);
    expect(await loadCaseOnServer('some-other-org', known.id, 'mock')).toBeNull();
  });

  it('wix mode reads the row directly, scoped to the organization — no relative fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await loadCaseOnServer('managed-cremations', 'case-live', 'wix'))?.id).toBe('case-live');
    expect(await loadCaseOnServer('gus-camacho-jr', 'case-live', 'wix')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('structural: server code never uses the browser-only case accessor', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it('no route, webhook or service calls casesService.get/update/create except in mock mode', () => {
    const offenders: string[] = [];
    for (const file of [...walk(join(process.cwd(), 'app/api')), ...walk(join(process.cwd(), 'services'))]) {
      if (file.endsWith('services/casesService.ts')) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const match of source.matchAll(/casesService\.(get|update|create)\(([^)]*)\)/g)) {
        if (!/'mock'/.test(match[2])) offenders.push(`${file.replace(process.cwd() + '/', '')}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
