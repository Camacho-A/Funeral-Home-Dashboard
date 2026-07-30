/**
 * Phase 25 (Document Generation & Template Management). Strips executable
 * content from a template body before it is ever persisted or rendered —
 * `<script>` tags, inline event-handler attributes, `javascript:` URLs,
 * and embed-style tags (`<iframe>`/`<object>`/`<embed>`). Template bodies
 * are authored by trusted org staff, but this still matters for two
 * independent reasons: (1) a compromised or malicious org account should
 * never be able to embed executable content that could run in another
 * context, and (2) the headless-Chromium render step
 * (`lib/puppeteerDocumentRenderer.ts`) executing attacker-controlled HTML
 * server-side would be a genuine SSRF/code-execution risk — this
 * sanitization pass is the first of two layers; the renderer's own
 * network lockdown (blocking every non-`data:` request) is the second,
 * independent one.
 *
 * A narrow, hand-rolled allowlist-style sanitizer rather than a new
 * dependency (e.g. `sanitize-html`/DOMPurify) — deliberate, matching this
 * project's general bias against adding a library for a constrained,
 * well-understood input domain (letters/contracts, not arbitrary
 * user-generated web content). Not a full HTML parser; this is a
 * defense-in-depth layer, not the only one (see the renderer's network
 * lockdown above).
 */

const SCRIPT_TAG = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const IFRAME_TAG = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi;
const OBJECT_TAG = /<object\b[^>]*>[\s\S]*?<\/object\s*>/gi;
const EMBED_TAG = /<embed\b[^>]*\/?>/gi;
const SELF_CLOSING_SCRIPT_OR_IFRAME = /<(script|iframe)\b[^>]*\/>/gi;
const EVENT_HANDLER_ATTR = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL_ATTR = /\s(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi;

export function sanitizeTemplateBody(html: string): string {
  return html
    .replace(SCRIPT_TAG, '')
    .replace(IFRAME_TAG, '')
    .replace(OBJECT_TAG, '')
    .replace(EMBED_TAG, '')
    .replace(SELF_CLOSING_SCRIPT_OR_IFRAME, '')
    .replace(EVENT_HANDLER_ATTR, '')
    .replace(JAVASCRIPT_URL_ATTR, '');
}
