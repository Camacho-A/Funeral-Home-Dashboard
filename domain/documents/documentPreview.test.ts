import { describe, it, expect } from 'vitest';
import { resolveDocumentPreviewKind } from './documentPreview';

describe('resolveDocumentPreviewKind', () => {
  it('renders a stored PDF with the in-app PDF viewer', () => {
    expect(resolveDocumentPreviewKind('application/pdf', 'GOLLIS ATTESTATION.pdf')).toBe('pdf');
  });

  it('treats the MIME type case-insensitively and ignores surrounding space', () => {
    expect(resolveDocumentPreviewKind(' APPLICATION/PDF ', 'statement.pdf')).toBe('pdf');
  });

  it('renders uploaded photographs directly', () => {
    expect(resolveDocumentPreviewKind('image/jpeg', 'permit.jpg')).toBe('image');
    expect(resolveDocumentPreviewKind('image/png', 'id-scan.png')).toBe('image');
  });

  it('reports a Word document as undisplayable rather than showing an empty frame', () => {
    expect(
      resolveDocumentPreviewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'RECEIPT OF PAYMENT.docx'),
    ).toBe('unsupported');
  });

  it('does not let a file name override a specific MIME type', () => {
    // A .docx deliberately named like a PDF must not be handed to pdf.js.
    expect(
      resolveDocumentPreviewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'not-really.pdf'),
    ).toBe('unsupported');
  });

  it('falls back to the extension when the upload was stored as octet-stream', () => {
    // What a browser sends when it cannot identify the file it picked.
    expect(resolveDocumentPreviewKind('application/octet-stream', 'arrangement.pdf')).toBe('pdf');
    expect(resolveDocumentPreviewKind('application/octet-stream', 'scan.PNG')).toBe('image');
    expect(resolveDocumentPreviewKind('application/octet-stream', 'notes.docx')).toBe('unsupported');
  });

  it('falls back to the extension when no MIME type was recorded at all', () => {
    expect(resolveDocumentPreviewKind(null, 'first-call.pdf')).toBe('pdf');
    expect(resolveDocumentPreviewKind(undefined, 'first-call.pdf')).toBe('pdf');
    expect(resolveDocumentPreviewKind('', 'first-call.pdf')).toBe('pdf');
  });

  it('does not mistake a dotfile or an extensionless name for a renderable type', () => {
    expect(resolveDocumentPreviewKind(null, '.pdf')).toBe('unsupported');
    expect(resolveDocumentPreviewKind(null, 'scanned-document')).toBe('unsupported');
  });
});
