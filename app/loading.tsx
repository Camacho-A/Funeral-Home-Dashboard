/**
 * Global loading convention (Frontend Engineering Plan, Phase 0). Route segments
 * that need a more specific loading treatment (e.g. a skeleton matching a
 * screen's real layout) add their own loading.tsx, which takes precedence over
 * this one for that segment.
 */
export default function Loading() {
  return (
    <div role="status" style={{ padding: 32 }}>
      Loading&hellip;
    </div>
  );
}
