import type { DocumentTemplate } from '../../types/documentTemplate';
import type { CaseDocument } from '../../types/caseDocument';
import type { SignatureRequest } from '../../types/signatureRequest';
import type { SignatureRecord } from '../../types/signatureRecord';
import { mockCollection } from './mockStore';

/**
 * Phase 25 (Document Generation & Template Management). Mock-mode
 * fixtures — same "in-memory array, mutated in place by the service's
 * mock branch" convention as every other `services/__mocks__/*Fixtures.ts`
 * file. Both start empty: no organization has any templates or documents
 * on day one. Unlike the Wix-mode two-collection split (`documentTemplates`/
 * `documentTemplateVersions` — see lib/wixDocumentTemplateMapper.ts),
 * mock mode keeps `DocumentTemplate.versions` nested inline directly,
 * exactly matching `services/__mocks__/workflowTemplates.ts`'s own
 * precedent for `WorkflowTemplate`.
 */
export const documentTemplateFixtures: DocumentTemplate[] = mockCollection('documentTemplateFixtures', (): DocumentTemplate[] => []);
export const caseDocumentFixtures: CaseDocument[] = mockCollection('caseDocumentFixtures', (): CaseDocument[] => []);

/** Phase 26 (Electronic Signatures & Authorization Workflows). Same
    convention — both start empty. */
export const signatureRequestFixtures: SignatureRequest[] = mockCollection('signatureRequestFixtures', (): SignatureRequest[] => []);
export const signatureRecordFixtures: SignatureRecord[] = mockCollection('signatureRecordFixtures', (): SignatureRecord[] => []);
