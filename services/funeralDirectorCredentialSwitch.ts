/**
 * Live funeral director credential storage on/off (Gus Phase 5H.1/5I).
 *
 * The `funeralDirectorCredentials` Wix collection exists (2026-11-18). Live
 * reads and writes happen ONLY in a deployment that explicitly sets
 *   SOLIS_FD_CREDENTIALS_STORAGE=wix   (and DATA_ADAPTER=wix).
 * No existing deployment sets it (Manors Production, both fictional
 * sandboxes), so every existing deployment stays off. The organization
 * profile must also have `funeralDirectorCredentials` (Gus only) —
 * services/funeralDirectorCredentialService.ts checks that separately.
 * Turning it on is a deployment decision that needs approval.
 */
export const FUNERAL_DIRECTOR_CREDENTIALS_STORAGE_ENV = 'SOLIS_FD_CREDENTIALS_STORAGE';

export function funeralDirectorCredentialsLive(env: Record<string, string | undefined> = process.env): boolean {
  return env[FUNERAL_DIRECTOR_CREDENTIALS_STORAGE_ENV]?.trim() === 'wix' && (env.DATA_ADAPTER ?? '').trim().toLowerCase() === 'wix';
}
