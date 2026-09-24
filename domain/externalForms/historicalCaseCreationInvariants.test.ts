import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Manors Jotform integration — historical CASE creation (2026-09).
 * `domain/externalForms/criticalInvariants.test.ts` asserts that every
 * OTHER Jotform-integration file never references case creation at all.
 * This file asserts the deliberate, narrow exception:
 * `app/api/cases/historical-jotform-import/route.ts` is the ONLY file in
 * this integration permitted to result in a new Case — and even it may
 * only do so through the normal, unmodified `POST /api/cases` contract,
 * never by directly touching case-number allocation or the `cases`
 * collection itself.
 */

const HISTORICAL_CASE_CREATION_ROUTE = 'app/api/cases/historical-jotform-import/route.ts';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Historical case creation — the one approved exception to the case-first invariant', () => {
  it('creates a case ONLY via a same-origin fetch to the normal POST /api/cases endpoint', () => {
    const code = stripComments(readFile(HISTORICAL_CASE_CREATION_ROUTE));
    expect(code).toMatch(/fetch\(`\$\{origin\}\/api\/cases`/);
  });

  it('never directly imports or calls reserveNextCaseNumber', () => {
    const code = stripComments(readFile(HISTORICAL_CASE_CREATION_ROUTE));
    expect(code).not.toMatch(/reserveNextCaseNumber/);
    expect(code).not.toMatch(/from ['"].*\/wixCaseNumberSequence['"]/);
  });

  it('never directly inserts into the cases collection', () => {
    const code = stripComments(readFile(HISTORICAL_CASE_CREATION_ROUTE));
    expect(code).not.toMatch(/insertWixDataItem\(\s*['"]cases['"]/);
    expect(code).not.toMatch(/insertWixDataItem<WixCaseItem>/);
  });

  it('never hardcodes or otherwise fabricates a specific case number literal', () => {
    const code = stripComments(readFile(HISTORICAL_CASE_CREATION_ROUTE));
    // No B-prefixed case-number-shaped literal anywhere in this file.
    expect(code).not.toMatch(/['"]B\d{4}-\d+['"]/);
  });

  it('is explicitly NOT part of criticalInvariants.test.ts\'s scanned file list — the exemption is deliberate, not a gap', () => {
    const invariantsTestSource = readFile('domain/externalForms/criticalInvariants.test.ts');
    expect(invariantsTestSource).not.toContain(HISTORICAL_CASE_CREATION_ROUTE);
  });

  it('the normal webhook route remains structurally incapable of creating a case (unchanged, re-asserted here)', () => {
    const code = stripComments(readFile('app/api/webhooks/jotform/route.ts'));
    expect(code).not.toMatch(/reserveNextCaseNumber/);
    expect(code).not.toMatch(/fetch\(`\$\{origin\}\/api\/cases`/);
    expect(code).not.toMatch(/insertWixDataItem\(\s*['"]cases['"]/);
  });

  it('the existing "link to existing case" importer remains structurally incapable of creating a case (unchanged, re-asserted here)', () => {
    const code = stripComments(readFile("app/api/cases/[caseId]/forms/[formConfigId]/import-submission/route.ts"));
    expect(code).not.toMatch(/reserveNextCaseNumber/);
    expect(code).not.toMatch(/fetch\(`\$\{origin\}\/api\/cases`/);
    expect(code).not.toMatch(/insertWixDataItem\(\s*['"]cases['"]/);
  });
});
