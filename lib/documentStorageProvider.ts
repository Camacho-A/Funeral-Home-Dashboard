/**
 * Phase 25 (Document Generation & Template Management). The provider-
 * neutral boundary every object-storage backend (Vercel Blob today; S3/R2
 * whenever a second is needed) implements — nothing in
 * `services/documentService.ts` or any Route Handler imports a
 * Vercel-Blob-specific type or calls a Vercel-Blob-specific function
 * directly; they only ever hold a `DocumentStorageProvider` and call
 * these three methods. Adding a second provider later means writing
 * `lib/<provider>/*StorageProvider.ts` and one line in
 * `getDocumentStorageProvider()` (services/documentService.ts) — no
 * change to document-domain logic, routes, or UI. Mirrors
 * `lib/paymentProvider.ts`'s exact precedent for Clover.
 *
 * **Correction made during implementation (not assumed in planning):**
 * the original plan described `getDownloadUrl` minting a short-lived
 * *signed* URL for the browser to hit directly. Vercel Blob does not
 * actually support expiring/signed URLs — a blob's URL is a long-lived,
 * unguessable-suffix public URL with no built-in expiry mechanism. Rather
 * than hand the browser a URL that, once seen, works indefinitely, this
 * interface instead exposes `downloadFile`, which returns the raw bytes
 * for the download Route Handler to stream back itself — the browser
 * never receives a Vercel Blob URL at all, only Beacon's own
 * `/api/cases/[caseId]/documents/[documentId]/download` endpoint, which
 * re-checks authorization on every single request. This is a strictly
 * stronger guarantee than a signed URL with expiry (no token to leak,
 * ever), so this is a correction in the secure direction, not a
 * regression from the original plan.
 */

export type DocumentStorageProvider = {
  /** Uploads `contents` under `key` and returns the opaque storage
      reference to persist as `CaseDocument.storageKey` — never a URL. */
  uploadFile(key: string, contents: Buffer, contentType: string): Promise<{ storageKey: string }>;

  /** Fetches the exact stored bytes for `storageKey` — called only from
      inside `services/documentService.ts`'s download flow, never
      exposed to the browser directly. */
  downloadFile(storageKey: string): Promise<{ buffer: Buffer; contentType: string }>;

  deleteFile(storageKey: string): Promise<void>;
};
