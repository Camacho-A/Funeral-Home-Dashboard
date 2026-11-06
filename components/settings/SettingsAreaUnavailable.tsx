import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * A Settings area this organization does not have (2026-11), reached by
 * typing its address: says so plainly, with the way back — instead of a
 * page that loads forever or offers controls the server would refuse.
 */
export function SettingsAreaUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <EmptyState message={message} helperText="Nothing here applies to this organization." />
      <p style={{ marginTop: 12 }}>
        <Link href="/settings">← Back to Settings</Link>
      </p>
    </div>
  );
}
