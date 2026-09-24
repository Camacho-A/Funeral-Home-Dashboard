import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). The one
 * invariant this entire integration exists to protect: Jotform must NEVER
 * create a Solis case or allocate a case number. Enforced structurally,
 * not just by code review — every file in this integration's webhook/
 * linking/reconciliation surface is scanned for a reference to case
 * creation or sequence allocation. A future edit that accidentally wires
 * one of these in fails this test immediately, regardless of intent.
 */

const INTEGRATION_FILES = [
  'app/api/webhooks/jotform/route.ts',
  'app/api/external-form-submissions/route.ts',
  'app/api/external-form-submissions/[submissionId]/link/route.ts',
  'app/api/external-form-submissions/[submissionId]/review/route.ts',
  'app/api/cases/[caseId]/forms/route.ts',
  'app/api/cases/[caseId]/forms/[formConfigId]/generate-link/route.ts',
  'app/api/cases/[caseId]/forms/[formConfigId]/import-submission/route.ts',
  'services/externalFormSubmissionService.ts',
  'services/caseFormLinkService.ts',
  'services/externalFormConfigService.ts',
  'services/externalFormPdfService.ts',
];

const FORBIDDEN_PATTERNS = [
  /reserveNextCaseNumber/,
  /from ['"].*\/wixCaseNumberSequence['"]/,
  /casesService\.create\b/,
  /\bcreateIdentitySession\b/, // sanity guard against copy-paste from an unrelated session file
];

/** Strips `/* ... *\/` block comments and `// ...` line comments before
    scanning — this test checks for actual CODE references (an import, a
    function call), never a mention inside this integration's own
    explanatory prose (which legitimately names these symbols to explain
    why they're absent). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Jotform integration — case-creation/case-number invariant', () => {
  for (const relativePath of INTEGRATION_FILES) {
    it(`${relativePath} never references case creation or case-number allocation in code`, () => {
      const fullPath = path.join(process.cwd(), relativePath);
      const code = stripComments(fs.readFileSync(fullPath, 'utf8'));
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(code).not.toMatch(pattern);
      }
      // Also forbid importing the POST /api/cases route's own module directly.
      expect(code).not.toMatch(/from ['"]@\/app\/api\/cases\/route['"]/);
    });
  }

  it('the webhook route never imports POST /api/cases or reserveNextCaseNumber in code, and only ever writes externalFormSubmissions/caseFormLinks state', () => {
    const code = stripComments(fs.readFileSync(path.join(process.cwd(), 'app/api/webhooks/jotform/route.ts'), 'utf8'));
    expect(code).not.toContain('reserveNextCaseNumber');
    expect(code).not.toContain("insertWixDataItem('cases'");
    expect(code).toContain('externalFormSubmissionService');
  });

  it('the manual-link route never creates a case in code — caseId is always treated as pre-existing', () => {
    const code = stripComments(
      fs.readFileSync(path.join(process.cwd(), 'app/api/external-form-submissions/[submissionId]/link/route.ts'), 'utf8'),
    );
    expect(code).not.toContain('reserveNextCaseNumber');
    expect(code).not.toMatch(/POST\s*\(.*\/api\/cases['"`]\s*,\s*\{\s*method:\s*['"]POST['"]/);
  });
});
