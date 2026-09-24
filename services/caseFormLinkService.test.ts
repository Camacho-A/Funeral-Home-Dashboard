import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { caseFormLinkFixtures } from './__mocks__/externalFormFixtures';

let lengthBefore: number;
beforeEach(() => {
  lengthBefore = caseFormLinkFixtures.length;
});
afterEach(() => {
  caseFormLinkFixtures.length = lengthBefore;
});

describe('generateLinkForSending / resolveByRawToken', () => {
  it('generates a token whose raw form is never persisted — only its hash', async () => {
    const { generateLinkForSending } = await import('./caseFormLinkService');
    const { link, rawToken } = await generateLinkForSending('org-1', 'case-1', 'jotform', 'config-vs', 'mock');
    expect(link.linkTokenHash).not.toBe(rawToken);
    expect(link.linkTokenHash).toHaveLength(64); // sha256 hex
    expect(rawToken).not.toBe('');
  });

  it('resolves a CaseFormLink by its raw token via hash lookup', async () => {
    const { generateLinkForSending, resolveByRawToken } = await import('./caseFormLinkService');
    const { link, rawToken } = await generateLinkForSending('org-2', 'case-2', 'jotform', 'config-vs', 'mock');
    const resolved = await resolveByRawToken(rawToken, 'mock');
    expect(resolved?.id).toBe(link.id);
  });

  it('regenerating invalidates the previous raw token — the old token no longer resolves', async () => {
    const { generateLinkForSending, resolveByRawToken } = await import('./caseFormLinkService');
    const { rawToken: firstToken } = await generateLinkForSending('org-3', 'case-3', 'jotform', 'config-vs', 'mock');
    const { rawToken: secondToken } = await generateLinkForSending('org-3', 'case-3', 'jotform', 'config-vs', 'mock');

    expect(await resolveByRawToken(firstToken, 'mock')).toBeNull();
    expect((await resolveByRawToken(secondToken, 'mock'))?.caseId).toBe('case-3');
  });

  it('Vital Statistics and Arrangement Forms get independent tokens for the same case', async () => {
    const { generateLinkForSending, resolveByRawToken } = await import('./caseFormLinkService');
    const vs = await generateLinkForSending('org-4', 'case-4', 'jotform', 'config-vs', 'mock');
    const af = await generateLinkForSending('org-4', 'case-4', 'jotform', 'config-af', 'mock');

    expect(vs.link.id).not.toBe(af.link.id);
    expect(vs.rawToken).not.toBe(af.rawToken);
    expect((await resolveByRawToken(vs.rawToken, 'mock'))?.formConfigId).toBe('config-vs');
    expect((await resolveByRawToken(af.rawToken, 'mock'))?.formConfigId).toBe('config-af');
  });

  it('an invalid/unknown raw token resolves to null', async () => {
    const { resolveByRawToken } = await import('./caseFormLinkService');
    expect(await resolveByRawToken('never-issued-token', 'mock')).toBeNull();
  });

  it('generating a link twice for the same (case, form-slot) reuses one row, not two', async () => {
    const { generateLinkForSending, listForCase } = await import('./caseFormLinkService');
    await generateLinkForSending('org-5', 'case-5', 'jotform', 'config-vs', 'mock');
    await generateLinkForSending('org-5', 'case-5', 'jotform', 'config-vs', 'mock');
    const links = await listForCase('org-5', 'case-5', 'mock');
    expect(links).toHaveLength(1);
  });
});

describe('organization isolation', () => {
  it('listForCase never returns another organization\'s links for the same caseId', async () => {
    const { generateLinkForSending, listForCase } = await import('./caseFormLinkService');
    await generateLinkForSending('org-a', 'shared-case-id', 'jotform', 'config-vs', 'mock');
    const results = await listForCase('org-b', 'shared-case-id', 'mock');
    expect(results).toHaveLength(0);
  });
});

describe('markReceived / markReviewed / linkExistingSubmission', () => {
  it('markReceived transitions status and records the submission id', async () => {
    const { generateLinkForSending, markReceived } = await import('./caseFormLinkService');
    const { link } = await generateLinkForSending('org-6', 'case-6', 'jotform', 'config-vs', 'mock');
    const updated = await markReceived(link.id, 'submission-1', 'mock');
    expect(updated?.status).toBe('received');
    expect(updated?.submissionId).toBe('submission-1');
  });

  it('linkExistingSubmission creates the slot on demand and marks it received, without ever generating a token', async () => {
    const { linkExistingSubmission, listForCase } = await import('./caseFormLinkService');
    const link = await linkExistingSubmission('org-7', 'case-7', 'jotform', 'config-af', 'submission-2', 'mock');
    expect(link.status).toBe('received');
    expect(link.submissionId).toBe('submission-2');
    const all = await listForCase('org-7', 'case-7', 'mock');
    expect(all).toHaveLength(1);
  });
});
