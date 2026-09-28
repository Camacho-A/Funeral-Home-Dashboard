import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// globals:false (vitest.config.ts) means @testing-library/react can't find
// a global afterEach to auto-register its own cleanup with, so every
// render() call would otherwise leave its tree in the DOM for the next
// test in the same file — explicit here instead.
afterEach(() => {
  cleanup();
});

// jsdom's own window.scrollTo logs a noisy "Not implemented" console error
// on every call instead of silently no-op'ing (Case Detail scroll-reset,
// item #9, is the first hook to call it during a render). Individual tests
// that need to assert scrollTo was called still override this via
// vi.stubGlobal('scrollTo', ...), which takes precedence per-test.
//
// Guarded (2026-09, Task #3): a handful of pure server-side route tests
// declare `@vitest-environment node` (pdf-lib's own PDFDocument.load does a
// strict `instanceof Uint8Array` check that fails against jsdom's distinct
// Uint8Array realm — a real Node Buffer is never `instanceof` jsdom's own
// Uint8Array). This setup file still runs for those files even without a
// DOM, so `window` must be checked rather than assumed.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
