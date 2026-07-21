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
