import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/** `npm run test:date-drift` — see vitest.date-drift.setup.ts. */
export default mergeConfig(
  baseConfig,
  defineConfig({ test: { setupFiles: ['./vitest.setup.ts', './vitest.date-drift.setup.ts'] } }),
);
