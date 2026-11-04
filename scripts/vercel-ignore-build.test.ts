import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldBuild } from './vercel-ignore-build.mjs';

const SCRIPT = path.resolve(__dirname, 'vercel-ignore-build.mjs');
const exitCode = (env: Record<string, string>) => {
  try {
    execFileSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
};

describe('vercel-ignore-build', () => {
  it('without an allowlist every branch builds — the project behaves exactly as today', () => {
    expect(shouldBuild('master', undefined)).toBe(true);
    expect(shouldBuild('feat/anything', '')).toBe(true);
  });

  it('with an allowlist only the listed branches build', () => {
    expect(shouldBuild('release/manors', 'release/manors')).toBe(true);
    expect(shouldBuild('master', 'release/manors')).toBe(false);
    expect(shouldBuild('release/gus', 'release/manors')).toBe(false);
    expect(shouldBuild('feat/price-catalog', 'release/manors')).toBe(false);
    expect(shouldBuild('preview/gus-onboarding', 'master, preview/*')).toBe(true);
    expect(shouldBuild('previewing', 'preview/*')).toBe(false);
    expect(shouldBuild('', 'release/manors')).toBe(false);
  });

  it('follows Vercel\'s exit-code contract: 1 builds, 0 skips', () => {
    expect(exitCode({ VERCEL_GIT_COMMIT_REF: 'release/manors', SOLIS_BUILD_BRANCHES: 'release/manors' })).toBe(1);
    expect(exitCode({ VERCEL_GIT_COMMIT_REF: 'master', SOLIS_BUILD_BRANCHES: 'release/manors' })).toBe(0);
    expect(exitCode({ VERCEL_GIT_COMMIT_REF: 'master' })).toBe(1);
  });
});
