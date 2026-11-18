import { mockCollection } from './mockStore';
import { buildGusCredentialFixtures } from './gusFixtures';
import type { FuneralDirectorCredentialRecord } from '../../domain/staff/funeralDirectorCredentials';

/** Gus Phase 5G: funeral director credential records (fictional sandbox
    data only). No live store exists yet — see docs/SERVICE_PREPARATION.md. */
export const funeralDirectorCredentialFixtures: FuneralDirectorCredentialRecord[] = mockCollection('funeralDirectorCredentialFixtures', () => buildGusCredentialFixtures());
