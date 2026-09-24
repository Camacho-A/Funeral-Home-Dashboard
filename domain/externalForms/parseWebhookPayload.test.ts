import { describe, expect, it } from 'vitest';
import { parseJotformWebhookBody, extractHiddenFieldByQid } from './parseWebhookPayload';

describe('parseJotformWebhookBody', () => {
  it('parses formId/submissionId and qid-keyed answers from a JSON rawRequest blob', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ q1_caseNo: 'B2026-034', '45_soliswebhookauth': 'secret-value' }),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.formId).toBe('form-1');
    expect(parsed!.submissionId).toBe('sub-1');
    expect(parsed!.answers['1'].answer).toBe('B2026-034');
    expect(parsed!.answers['45'].answer).toBe('secret-value');
  });

  it('returns null for a missing/empty formID or submissionID', () => {
    expect(parseJotformWebhookBody({ submissionID: 'sub-1', rawRequest: '{}' })).toBeNull();
    expect(parseJotformWebhookBody({ formID: '', submissionID: 'sub-1', rawRequest: '{}' })).toBeNull();
    expect(parseJotformWebhookBody({ formID: 'form-1', rawRequest: '{}' })).toBeNull();
  });

  it('never throws on a malformed rawRequest blob — resolves to empty answers instead', () => {
    const parsed = parseJotformWebhookBody({ formID: 'form-1', submissionID: 'sub-1', rawRequest: '{not valid json' });
    expect(parsed).not.toBeNull();
    expect(parsed!.answers).toEqual({});
  });

  it('captures a compound (object) answer at its qid, distinct from a plain string answer', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '3_nameof': { first: 'John', last: 'Doe' } }),
    });
    expect(parsed!.answers['3']).toEqual({ answer: { first: 'John', last: 'Doe' } });
  });
});

describe('extractHiddenFieldByQid — qid-driven only, never by name', () => {
  it('extracts a value from a {qid}_{name}-prefixed rawRequest key, via the parsed answers map', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '45_soliswebhookauth': 'secret-value' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBe('secret-value');
  });

  it('extracts a value from a bare {qid: value} rawRequest entry', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '45': 'secret-value' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBe('secret-value');
  });

  it('extracts a value from a bare {qid: {answer: value}} rawRequest entry', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '45': { answer: 'secret-value' } }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBe('secret-value');
  });

  it('a matching field NAME at the WRONG qid is never extracted — qid is the only trusted identifier', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '275_soliswebhookauth': 'secret-value' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBeNull();
  });

  it('casing differences in the internal field name are irrelevant — only the qid is consulted', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '45_SolisWebhookAuth': 'secret-value' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBe('secret-value');
  });

  it('an auto-generated placeholder name (e.g. input274) is irrelevant — only the qid is consulted', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '274_input274': 'raw-link-token-value' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '274')).toBe('raw-link-token-value');
  });

  it('returns null when the qid is entirely absent from the payload', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ q1_caseNo: 'B2026-034' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBeNull();
  });

  it('treats an empty string as absent, never as a valid (empty) value', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '45_soliswebhookauth': '' }),
    });
    expect(extractHiddenFieldByQid(parsed!, '45')).toBeNull();
  });

  it('a compound/object answer at the requested qid is treated as not-found, never guessed at', () => {
    const parsed = parseJotformWebhookBody({
      formID: 'form-1',
      submissionID: 'sub-1',
      rawRequest: JSON.stringify({ '3_nameof': { first: 'John', last: 'Doe' } }),
    });
    expect(extractHiddenFieldByQid(parsed!, '3')).toBeNull();
  });
});
