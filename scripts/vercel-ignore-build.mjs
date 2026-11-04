#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" for SOLIS projects (2026-11, deployment
 * isolation — docs/VERCEL_DEPLOYMENT_ISOLATION.md).
 *
 * INERT until a project's Settings → Git → Ignored Build Step is set to
 * `node scripts/vercel-ignore-build.mjs` AND that project defines
 * SOLIS_BUILD_BRANCHES. Without the variable every branch builds, exactly
 * as today.
 *
 *   SOLIS_BUILD_BRANCHES="release/manors"            only that branch builds
 *   SOLIS_BUILD_BRANCHES="master,preview/*"          master and preview/… branches
 *
 * Vercel's contract: exit 1 = build, exit 0 = skip. Reads only the branch
 * name Vercel provides (VERCEL_GIT_COMMIT_REF); no secrets, no network.
 */

/** Whether a deployment of `branch` should build, given the allowlist text. */
export function shouldBuild(branch, allowlist) {
  const patterns = (allowlist ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (patterns.length === 0) return true;
  if (!branch) return false;
  return patterns.some((pattern) => (pattern.endsWith('*') ? branch.startsWith(pattern.slice(0, -1)) : branch === pattern));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? '';
  const build = shouldBuild(branch, process.env.SOLIS_BUILD_BRANCHES);
  console.log(`[solis] ${build ? 'Building' : 'Skipping'} ${branch || '(unknown branch)'} for ${process.env.VERCEL_PROJECT_ID ?? 'this project'}.`);
  process.exit(build ? 1 : 0);
}
