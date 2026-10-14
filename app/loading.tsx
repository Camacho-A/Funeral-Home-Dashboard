import { StalledLoading } from '@/components/ui/StalledLoading';

/**
 * Global loading convention (Frontend Engineering Plan, Phase 0). Route segments
 * that need a more specific loading treatment (e.g. a skeleton matching a
 * screen's real layout) add their own loading.tsx, which takes precedence over
 * this one for that segment.
 *
 * Stalled-loading recovery (2026-10): this is the fallback staff were left
 * stranded on when a route rendered but never finished — see
 * components/ui/StalledLoading.tsx for the full reasoning. It still reads
 * "Loading…" for as long as loading is a reasonable thing to be doing; past
 * that it says so and offers a way out.
 */
export default function Loading() {
  return <StalledLoading />;
}
