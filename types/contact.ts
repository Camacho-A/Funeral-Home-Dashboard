/**
 * Not consumed by any service or hook yet — the prototype only ever shows a
 * single next-of-kin, stored directly on Case (nextOfKinName/nextOfKinPhone;
 * see types/case.ts). This type exists for the fuller multi-contact model
 * docs/CMS_SCHEMA.md's CaseContacts collection anticipates, in case a future
 * screen needs more than one contact per case. Phase 6 decides whether it's
 * actually needed when Case Detail is built — do not wire a service/hook
 * around this ahead of that.
 */
export type CaseContact = {
  id: string;
  organizationId: string;
  caseId: string;
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
  isPrimaryContact: boolean;
  isAuthorizedAgent: boolean;
};
