/**
 * Task #3 (2026-09). Pure, storage-independent helpers shared by
 * services/documentService.ts's buildBulkDownloadZip/buildBulkPrintPdf —
 * kept here (not in documentService.ts itself) so they can be unit tested
 * without the storage-provider/renderer mocking every other
 * documentService.ts test requires, and so the structural boundary
 * asserted by documentService.test.ts ("only documentService.ts imports
 * the concrete renderer/storage provider") stays trivially true — this
 * file imports neither.
 */

/** MIME types the combined Print All PDF can safely include without any
    conversion step. Every origin: 'generated' CaseDocument (Statements,
    templated documents) is always application/pdf - see
    documentService.ts's renderAndStorePdf/generateBillingDocument, both
    hardcoded to it. Only origin: 'uploaded' documents can be anything
    else: the upload route's own ALLOWED_MIME_TYPES permits JPEG/PNG
    (safely embeddable as a full PDF page via pdf-lib, no rasterization
    service needed) and DOCX (excluded - genuinely unsafe to merge into a
    PDF without a real conversion engine this environment does not have;
    Download All still includes it unmodified). */
const PRINTABLE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function isPrintableMimeType(mimeType: string): boolean {
  return PRINTABLE_MIME_TYPES.has(mimeType);
}

/** Case Numbers are always the strict, server-generated B{YYYY}-{###}
    shape (domain/cases/caseNumber.ts) - this exists as a defensive
    fallback only, never relied on to "clean up" a real case number. */
function sanitizeForFileNameSegment(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.'); // collapse any ".." (or longer) run — no traversal-like sequence survives
  return cleaned.length > 0 ? cleaned : 'case';
}

export function buildBulkDownloadZipFileName(caseNumber: string): string {
  return `${sanitizeForFileNameSegment(caseNumber)}-documents.zip`;
}

export function buildBulkPrintPdfFileName(caseNumber: string): string {
  return `${sanitizeForFileNameSegment(caseNumber)}-documents.pdf`;
}

/** Returns true for characters safe to keep verbatim in a ZIP entry name:
    ordinary printable characters, excluding ASCII control characters
    (0x00-0x1F and 0x7F) which some archive tools mishandle. */
function isSafeFileNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}

/**
 * Turns a CaseDocument.fileName (verbatim, staff/uploader-controlled - see
 * the upload route, which stores file.name unsanitized) into a safe ZIP
 * entry name: no directory separators or ".." traversal segments, no
 * leading dot (hidden-file convention some tools skip), no control
 * characters. Never returns an empty string.
 */
export function sanitizeZipEntryFileName(fileName: string): string {
  const leaf = fileName
    .replace(/\\/g, '/')
    .split('/')
    .pop()!; // path components (or traversal segments) are stripped - only the leaf name survives
  const cleaned = Array.from(leaf)
    .filter(isSafeFileNameChar)
    .join('')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * Handles the exact "duplicate filename" scenario this checkpoint calls
 * out by name: a regenerated Statement (or any regeneration) produces a
 * new CaseDocument row that legitimately shares its predecessor's
 * fileName (superseded/archived rows are still eligible for bulk actions
 * - see isCaseDocumentDownloadable). Input order is preserved (callers
 * pass documents in list()'s own newest-first order, so disambiguation is
 * deterministic across runs for the same document set) - the first
 * occurrence of a name keeps it as-is; each later occurrence gets " (n)"
 * appended before the extension.
 */
export function dedupeFileNames(fileNames: string[]): string[] {
  const seenCount = new Map<string, number>();
  return fileNames.map((name) => {
    const count = seenCount.get(name) ?? 0;
    seenCount.set(name, count + 1);
    if (count === 0) return name;

    const lastDot = name.lastIndexOf('.');
    const hasExtension = lastDot > 0; // a dot at index 0 is a hidden-file leading dot, not an extension
    const stem = hasExtension ? name.slice(0, lastDot) : name;
    const ext = hasExtension ? name.slice(lastDot) : '';
    return `${stem} (${count + 1})${ext}`;
  });
}
