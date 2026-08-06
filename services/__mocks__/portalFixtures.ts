import type { PortalUser } from '../../types/portalUser';
import type { PortalSession } from '../../types/portalSession';
import type { PortalAccess } from '../../types/portalAccess';
import type { PortalInvitation } from '../../types/portalInvitation';
import type { PortalMessage } from '../../types/portalMessage';

/**
 * Phase 29 (Family Portal & External Collaboration). Mock-mode fixtures —
 * same "in-memory arrays, mutated in place by the portal services' mock
 * branch" convention as every other `services/__mocks__/*Fixtures.ts`
 * file. Starts empty (unlike `identityFixtures.ts`, which seeds Manor's
 * Cremation's real administrator) — no Family Portal user exists for any
 * tenant until a real invitation is sent and accepted, mirroring
 * refinement #15's "no family self-registration."
 */
export const portalUserFixtures: PortalUser[] = [];
export const portalSessionFixtures: PortalSession[] = [];
export const portalAccessFixtures: PortalAccess[] = [];
export const portalInvitationFixtures: PortalInvitation[] = [];
export const portalMessageFixtures: PortalMessage[] = [];
