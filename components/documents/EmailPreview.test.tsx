import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailPreview } from './EmailPreview';
import { DocumentPreview } from './DocumentPreview';
import { HTML_ONLY_EML, NOK_AUTHORIZATION_EML, TEXT_WITH_MARKUP_EML, WITH_ATTACHMENT_EML, toBytes } from '@/lib/testing/emlFixtures';

/** Saved email viewer (2026-11) — fictional emails; fetch is stubbed. */
function serve(eml: string, ok = true) {
  const bytes = toBytes(eml);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })));
}

afterEach(() => vi.unstubAllGlobals());

describe('EmailPreview', () => {
  it('shows who sent it, to whom, when, the subject and the message', async () => {
    serve(NOK_AUTHORIZATION_EML);
    render(<EmailPreview url="/api/fictional/download" fileName="Authorization.eml" />);
    expect(await screen.findByRole('heading', { name: 'Authorization for my brother to make the arrangements' })).toBeTruthy();
    expect(screen.getByText('Maria Fictional <maria.fictional@example.com>')).toBeTruthy();
    expect(screen.getByText('Arrangements <arrangements@funeralhome.example>')).toBeTruthy();
    expect(screen.getByText('Jose Fictional <jose.fictional@example.com>')).toBeTruthy();
    expect(screen.getByText(/authorize my brother/)).toBeTruthy();
  });

  it('lists attachments with a Download button', async () => {
    serve(WITH_ATTACHMENT_EML);
    render(<EmailPreview url="/api/fictional/download" fileName="Signed.eml" />);
    expect(await screen.findByText('authorization.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.getByText('Attachments (1)')).toBeTruthy();
  });

  it('never renders the email’s HTML or markup — text only', async () => {
    serve(TEXT_WITH_MARKUP_EML);
    const { container } = render(<EmailPreview url="/api/fictional/download" fileName="Literal.eml" />);
    expect(await screen.findByText(/Ignore this:/)).toBeTruthy();
    expect(container.querySelector('script, img, iframe')).toBeNull();

    serve(HTML_ONLY_EML);
    const html = render(<EmailPreview url="/api/fictional/download-2" fileName="Html.eml" />);
    expect(await html.findByText(/José may sign & decide\./)).toBeTruthy();
    expect(html.container.querySelector('script, style, p > p')).toBeNull();
  });

  it('explains when the file cannot be shown', async () => {
    serve('not an email at all', true);
    render(<EmailPreview url="/api/fictional/download" fileName="Broken.eml" />);
    expect(await screen.findByText(/couldn’t be shown|couldn't be shown/)).toBeTruthy();
  });

  it('is what View shows for a stored .eml', async () => {
    serve(NOK_AUTHORIZATION_EML);
    render(<DocumentPreview url="/api/fictional/download" fileName="Authorization.eml" mimeType="message/rfc822" />);
    expect(await screen.findByRole('heading', { name: /Authorization for my brother/ })).toBeTruthy();
  });
});
