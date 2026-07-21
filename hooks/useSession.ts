import { staffFixtures } from '@/services/__mocks__/fixtures';
import type { Session } from '@/types/session';

export type { Session };

/**
 * Stubbed to a fixed mock staff user for this frontend-only phase — see
 * docs/ARCHITECTURE.md's auth section. Swapped for the real Wix-Members
 * session once the backend-integration phase wires up authentication; no
 * caller changes when that happens, since this hook's return shape stays
 * the same.
 */
export function useSession(): Session {
  const staff = staffFixtures[0];
  return { staffId: staff.id, displayName: staff.displayName };
}
