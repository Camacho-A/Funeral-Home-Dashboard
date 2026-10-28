import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { Case } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { JotformAnswerMap } from '@/domain/externalForms/extractMappedFields';
import type { ActivityContext } from './activityService';
import { loadCaseOnServer } from './serverCaseLoader';
import { generateBillingDocument } from './documentService';
import { listCaseSubmissionsNewestFirst } from './externalForms/caseSubmissions';
import { fetchSubmissionAnswers } from '@/lib/jotform/jotformClient';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import {
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
  VITAL_STATISTICS_EXTERNAL_FORM_ID,
} from '@/domain/externalForms/fieldMapping';
import {
  FEDEX_FEE_CENTS,
  MANATEE_APPLICATION_FILE_NAME,
  MAX_CERTIFICATES_PER_LINE,
  PRICE_PER_CERTIFICATE_CENTS,
  manateeIssues,
  maskSsn,
  normalizeSsn,
  relationshipForForm,
  type ManateeApplicationInput,
  type ManateeApplicationValues,
  type ManateeDraft,
  type ManateeDraftValues,
  type ManateeFormSource as FormSource,
} from '@/domain/documents/manateeDeathCertificateApplication';

export type { ManateeApplicationInput, ManateeDraft } from '@/domain/documents/manateeDeathCertificateApplication';
import { buildManateeApplicationPdf, loadManateeApplicationTemplate, ManateeTemplateError } from './manateeApplicationTemplate';

/**
 * Manatee County — Death Certificate Application (2026-10): the draft
 * staff review, the preview, and the saved case document.
 *
 * Sources, most reliable first, every value a suggestion staff can change
 * in the generation window (which never writes back to the case):
 *   - decedent first / middle / last, SSN, city of death, surviving spouse:
 *     the case's intake forms, read-only from Jotform — the Arrangement
 *     Form, then the Vital Statistics form, then the First Call Sheet,
 *     newest submission first. Names only ever from the forms' own
 *     first / middle / last boxes.
 *   - date of death, next of kin and relationship: the case.
 *   - county: neither the case nor any of the intake forms records it
 *     today, so staff always enter it — never inferred from a city name.
 *
 * The SSN never leaves the server except inside the filled PDF: the draft
 * carries only whether one is on file and its last four digits. It is
 * never logged, cached, put in a file name, or included in an error.
 */

export class ManateeApplicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function manateeApplicationEnabled(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.manateeDeathCertificateApplication;
}

/** Which intake-form question holds each value, per form. */
const FORM_QUESTIONS: Record<string, { name: string; ssn?: string; placeOfDeath: string; spouse?: string; label: FormSource }> = {
  [ARRANGEMENT_FORMS_EXTERNAL_FORM_ID]: { name: '87', ssn: '11', placeOfDeath: '97', spouse: '105', label: 'arrangement_form' },
  [VITAL_STATISTICS_EXTERNAL_FORM_ID]: { name: '3', ssn: '7', placeOfDeath: '30', spouse: '14', label: 'vital_statistics' },
  [FIRST_CALL_SHEET_EXTERNAL_FORM_ID]: { name: '3', placeOfDeath: '20', label: 'first_call_sheet' },
};
const FORM_PRIORITY: readonly FormSource[] = ['arrangement_form', 'vital_statistics', 'first_call_sheet'];


type FormFacts = {
  name: { first: string; middle: string; last: string } | null;
  ssn: string | null;
  city: string | null;
  spouse: { first: string; middle: string; last: string } | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const sub = (answer: unknown, key: string) => (answer && typeof answer === 'object' ? text((answer as Record<string, unknown>)[key]) : '');

function factsFromAnswers(answers: JotformAnswerMap, questions: (typeof FORM_QUESTIONS)[string]): FormFacts {
  const fullName = (qid: string | undefined) => {
    if (!qid) return null;
    const answer = answers[qid]?.answer;
    const name = { first: sub(answer, 'first'), middle: sub(answer, 'middle'), last: sub(answer, 'last') };
    return name.first || name.last ? name : null;
  };
  return {
    name: fullName(questions.name),
    ssn: questions.ssn ? normalizeSsn(text(answers[questions.ssn]?.answer)) : null,
    city: sub(answers[questions.placeOfDeath]?.answer, 'city') || null,
    spouse: fullName(questions.spouse),
  };
}

/** Read-only answers from each of the case's intake forms, best source first. */
async function formFactsFor(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<Array<{ source: FormSource; facts: FormFacts }>> {
  let submissions: ExternalFormSubmission[];
  try {
    submissions = await listCaseSubmissionsNewestFirst(organizationId, caseId, mode);
  } catch {
    return [];
  }
  const readable = submissions.filter((s) => s.provider === 'jotform' && s.externalSubmissionId && FORM_QUESTIONS[s.externalFormId]);
  const results = await Promise.all(
    readable.map(async (submission) => {
      try {
        const { answers } = await fetchSubmissionAnswers(submission.externalSubmissionId);
        const questions = FORM_QUESTIONS[submission.externalFormId];
        return { source: questions.label, facts: factsFromAnswers(answers, questions) };
      } catch {
        // Never the provider's error text — it could echo request details.
        return null;
      }
    }),
  );
  const found = results.filter((r): r is { source: FormSource; facts: FormFacts } => r !== null);
  // Stable: newest first within each form, forms in priority order.
  return FORM_PRIORITY.flatMap((source) => found.filter((r) => r.source === source));
}

function firstFrom<T>(forms: Array<{ source: FormSource; facts: FormFacts }>, pick: (facts: FormFacts) => T | null): { value: T; source: FormSource } | null {
  for (const form of forms) {
    const value = pick(form.facts);
    if (value) return { value, source: form.source };
  }
  return null;
}


async function loadCaseFor(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<Case> {
  if (!manateeApplicationEnabled(organizationId)) throw new ManateeApplicationError('Not available for this organization.', 404);
  const case_ = await loadCaseOnServer(organizationId, caseId, mode);
  if (!case_ || case_.organizationId !== organizationId) throw new ManateeApplicationError('Case not found.', 404);
  return case_;
}

async function draftFor(case_: Case, mode: DataAdapterMode): Promise<{ draft: Omit<ManateeDraft, 'template' | 'latest'>; ssn: string | null }> {
  const forms = await formFactsFor(case_.organizationId, case_.id, mode);
  const name = firstFrom(forms, (f) => (f.name?.first && f.name.last ? f.name : null));
  const ssn = firstFrom(forms, (f) => f.ssn);
  const city = firstFrom(forms, (f) => f.city);
  const spouse = firstFrom(forms, (f) => (f.spouse?.first || f.spouse?.last ? f.spouse : null));
  const relationship = relationshipForForm(case_.nextOfKinRelationship, case_.nextOfKinRelationshipOther);

  const values: ManateeDraftValues = {
    decedentFirst: name?.value.first ?? '',
    // The form's own middle box, else the case's middle name (2026-10, kept
    // separately on the case) — never a word taken from a full name.
    decedentMiddle: name ? name.value.middle || (case_.decedentMiddleName ?? '') : '',
    decedentLast: name?.value.last ?? '',
    ssnNotKnown: false,
    dateOfDeath: case_.dateOfDeath ?? '',
    placeOfDeathCity: city?.value ?? '',
    placeOfDeathCounty: '',
    spouseFirst: spouse?.value.first ?? '',
    spouseMiddle: spouse?.value.middle ?? '',
    spouseLast: spouse?.value.last ?? '',
    representedName: case_.nextOfKinName ?? '',
    representedRelationship: relationship ?? '',
    withCause: 0,
    withoutCause: 0,
    fedexFee: false,
    requestNumber: '',
    requestOf: '',
  };
  const sources: ManateeDraft['sources'] = {
    decedentFirst: name?.source ?? null,
    decedentMiddle: name ? (name.value.middle ? name.source : case_.decedentMiddleName ? 'case' : null) : null,
    decedentLast: name?.source ?? null,
    dateOfDeath: case_.dateOfDeath ? 'case' : null,
    placeOfDeathCity: city?.source ?? null,
    placeOfDeathCounty: null,
    spouseFirst: spouse?.source ?? null,
    spouseLast: spouse?.source ?? null,
    representedName: case_.nextOfKinName ? 'case' : null,
    representedRelationship: relationship ? 'case' : null,
  };
  const issues = manateeIssues({ ...values, ssn: ssn?.value ?? null });
  return {
    draft: {
      values,
      ssn: { onFile: Boolean(ssn), masked: maskSsn(ssn?.value), source: ssn?.source ?? null },
      sources,
      issues,
      pricing: { perCertificateCents: PRICE_PER_CERTIFICATE_CENTS, fedexCents: FEDEX_FEE_CENTS, maxPerLine: MAX_CERTIFICATES_PER_LINE },
    },
    ssn: ssn?.value ?? null,
  };
}

export async function getManateeApplicationDraft(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<ManateeDraft> {
  const case_ = await loadCaseFor(organizationId, caseId, mode);
  const [{ draft }, template, latest] = await Promise.all([draftFor(case_, mode), loadManateeApplicationTemplate(), latestApplication(organizationId, caseId, mode)]);
  return { ...draft, template: template.status === 'loaded' ? 'available' : template.status, latest };
}

async function latestApplication(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<ManateeDraft['latest']> {
  const { list } = await import('./documentService');
  const current = (await list(organizationId, caseId, mode)).find(
    (d) => d.documentTypeKey === DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key && d.status === 'active',
  );
  return current ? { id: current.id, version: current.version, createdAt: current.createdAt } : null;
}


/** The reviewed values with the SSN resolved on the server: staff's, else the form's. */
async function resolveValues(case_: Case, input: ManateeApplicationInput, mode: DataAdapterMode): Promise<ManateeApplicationValues> {
  const typed = typeof input.ssn === 'string' && input.ssn.trim() ? input.ssn : null;
  const ssn = input.ssnNotKnown ? null : (typed ?? (await draftFor(case_, mode)).ssn);
  const values: ManateeApplicationValues = { ...input, ssn };
  const issues = manateeIssues(values);
  if (issues.length > 0) throw new ManateeApplicationError(issues[0].message, 422);
  return values;
}

async function renderFor(case_: Case, input: ManateeApplicationInput, mode: DataAdapterMode): Promise<Uint8Array> {
  const values = await resolveValues(case_, input, mode);
  const template = await loadManateeApplicationTemplate();
  if (template.status !== 'loaded') {
    throw new ManateeApplicationError('The Manatee County form is not set up yet. Ask an administrator to add it.', 503);
  }
  try {
    return await buildManateeApplicationPdf(template.bytes, values);
  } catch (error) {
    if (error instanceof ManateeTemplateError) throw new ManateeApplicationError(error.message, 422);
    throw error;
  }
}

/** The filled PDF for staff to look at — never stored. */
export async function previewManateeApplication(organizationId: string, caseId: string, input: ManateeApplicationInput, mode: DataAdapterMode): Promise<Uint8Array> {
  const case_ = await loadCaseFor(organizationId, caseId, mode);
  return renderFor(case_, input, mode);
}

/** Saves the filled PDF to the case's documents: versioned (an earlier
    application moves to History), audited, downloadable and printable.
    Never sent or submitted anywhere. */
export async function saveManateeApplication(
  organizationId: string,
  caseId: string,
  input: ManateeApplicationInput,
  ctx: ActivityContext,
  mode: DataAdapterMode,
): Promise<CaseDocument> {
  const case_ = await loadCaseFor(organizationId, caseId, mode);
  const bytes = await renderFor(case_, input, mode);
  return generateBillingDocument(
    {
      caseId,
      documentTypeKey: DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key,
      category: DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.category,
      fileName: MANATEE_APPLICATION_FILE_NAME,
      buildPdf: async () => bytes,
      idFactory: () => crypto.randomUUID(),
    },
    ctx,
    mode,
  );
}
