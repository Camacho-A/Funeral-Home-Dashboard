import { describe, expect, it } from 'vitest';
import { EmailParseError, formatEmailAddress, htmlToPlainText, isEmailFile, parseEmail } from './emailMessage';
import { HTML_ONLY_EML, NOK_AUTHORIZATION_EML, TEXT_WITH_MARKUP_EML, WITH_ATTACHMENT_EML, toBytes } from '@/lib/testing/emlFixtures';

describe('isEmailFile', () => {
  it('recognises message/rfc822, and .eml when the browser gave no useful type', () => {
    expect(isEmailFile('message/rfc822', 'anything')).toBe(true);
    expect(isEmailFile('', 'Authorization.EML')).toBe(true);
    expect(isEmailFile('application/octet-stream', 'note.eml')).toBe(true);
    expect(isEmailFile('application/pdf', 'note.eml')).toBe(false);
    expect(isEmailFile('', 'note.pdf')).toBe(false);
  });
});

describe('parseEmail (fictional emails)', () => {
  it('reads sender, recipients, date, subject and message', async () => {
    const email = await parseEmail(toBytes(NOK_AUTHORIZATION_EML));
    expect(email.from).toEqual({ name: 'Maria Fictional', address: 'maria.fictional@example.com' });
    expect(email.to.map(formatEmailAddress)).toEqual(['Arrangements <arrangements@funeralhome.example>']);
    expect(email.cc.map((a) => a.address)).toEqual(['jose.fictional@example.com']);
    expect(email.date).toBe('2026-11-02T14:15:00.000Z');
    expect(email.subject).toBe('Authorization for my brother to make the arrangements');
    expect(email.text).toContain('authorize my brother');
    expect(email.attachments).toEqual([]);
  });

  it('lists attachments with their bytes', async () => {
    const email = await parseEmail(toBytes(WITH_ATTACHMENT_EML));
    expect(email.text).toBe('Please find my signed letter attached.');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({ fileName: 'authorization.pdf', mimeType: 'application/pdf' });
    expect(new TextDecoder().decode(email.attachments[0].content)).toBe('%PDF-1.4 fictional');
  });

  it('decodes encoded subjects and quoted-printable HTML, and turns HTML into text without scripts or styles', async () => {
    const email = await parseEmail(toBytes(HTML_ONLY_EML));
    expect(email.subject).toBe('Autorización');
    expect(email.text).toBe('José may sign & decide.\nThank you\nMaria');
    expect(email.text).not.toMatch(/alert|<|color:red/);
  });

  it('keeps markup-looking plain text as literal text', async () => {
    const email = await parseEmail(toBytes(TEXT_WITH_MARKUP_EML));
    expect(email.text).toBe('Ignore this: <img src=x onerror=alert(1)><script>alert(2)</script>');
  });

  it('refuses something that is not an email', async () => {
    await expect(parseEmail(toBytes('%PDF-1.4\n%fictional\n'))).rejects.toBeInstanceOf(EmailParseError);
    await expect(parseEmail(new Uint8Array([0, 1, 2, 3]))).rejects.toBeInstanceOf(EmailParseError);
  });
});

describe('htmlToPlainText', () => {
  it('handles numeric entities and collapses blank lines', () => {
    expect(htmlToPlainText('<p>A&#233;&#x41;</p><p></p><p></p><p>B</p>')).toBe('AéA\n\nB');
  });
});
