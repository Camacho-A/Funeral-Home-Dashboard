import { getSession } from './session';

/**
 * Workflow template editor (2026-10). The signed-in actor's display name
 * as it is right now — snapshotted onto a workflow template version
 * (createdByName / approvedByName) for Settings' version history. Display
 * only, never used for authorization; null when the session does not
 * belong to `userId` or carries no name. The activity log keeps the
 * authoritative actor id.
 */
export async function currentActorDisplayName(userId: string): Promise<string | null> {
  const session = await getSession().catch(() => null);
  return session?.user.id === userId && typeof session.user.displayName === 'string' && session.user.displayName.trim() !== ''
    ? session.user.displayName
    : null;
}
