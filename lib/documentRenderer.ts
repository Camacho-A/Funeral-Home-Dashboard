/**
 * Phase 25 (Document Generation & Template Management). The provider-
 * neutral boundary for turning merged HTML into a PDF — nothing in
 * `services/documentService.ts` imports a Puppeteer-specific type or
 * calls a Puppeteer-specific function directly; it only ever holds a
 * `DocumentRenderer` and calls this one method. Swapping the rendering
 * engine later (a different PDF library, an external rendering API) is a
 * new file implementing this interface + one line in
 * `getDocumentRenderer()` (services/documentService.ts) — no change to
 * document-domain logic, routes, or UI. Mirrors
 * `lib/documentStorageProvider.ts`'s and `lib/paymentProvider.ts`'s exact
 * precedent.
 */

export type DocumentRenderer = {
  /** Renders a complete, already-merged HTML document to a PDF buffer.
      `html` is expected to be a full document (or a fragment Beacon
      wraps in its own print stylesheet before calling this) — the
      renderer itself does no merge-field substitution; that already
      happened via domain/documents/mergeEngine.ts. */
  renderHtmlToPdf(html: string): Promise<Buffer>;
};
