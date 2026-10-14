/**
 * What SOLIS can show in-app for a stored document (2026-10).
 *
 * "View" is offered for every downloadable document, but the three stored
 * kinds need three different treatments: a PDF is rendered by SOLIS itself
 * (see components/documents/PdfViewer.tsx), an image is just an <img>, and
 * a Word document cannot be displayed in a browser at all. Deciding that
 * here keeps it a pure, testable rule rather than branching inside the
 * modal.
 */

export type DocumentPreviewKind = 'pdf' | 'image' | 'unsupported';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * The stored MIME type decides, because it is what the download route
 * actually serves.
 *
 * The file name is consulted only when the MIME type says nothing useful —
 * `application/octet-stream` is what an upload gets when the browser could
 * not identify it, so a file stored that way but plainly named `.pdf` is
 * still worth trying to render.
 */
export function resolveDocumentPreviewKind(mimeType: string | null | undefined, fileName: string): DocumentPreviewKind {
  const mime = (mimeType ?? '').trim().toLowerCase();

  if (mime === 'application/pdf') return 'pdf';
  if (IMAGE_MIME_TYPES.has(mime)) return 'image';

  // A known-but-undisplayable type (.docx and friends) is unsupported even
  // if its extension were to suggest otherwise — don't second-guess a
  // specific MIME type with a file name.
  if (mime !== '' && mime !== 'application/octet-stream') return 'unsupported';

  const ext = extensionOf(fileName);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'unsupported';
}
