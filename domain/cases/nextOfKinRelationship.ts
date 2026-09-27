import type { NextOfKinRelationship } from '../../types/case';

/**
 * Manors launch-prep. Display labels for the NOK-relationship dropdown —
 * shared between Case Detail's CaseInformationCard.tsx and the New Case
 * form (NewCaseModal.tsx, 2026-09) so both collect/edit the exact same
 * closed relationship model — never a second, parallel list.
 */
export const NEXT_OF_KIN_RELATIONSHIP_LABEL: Record<NextOfKinRelationship, string> = {
  spouse: 'Spouse',
  domestic_partner: 'Domestic Partner',
  son: 'Son',
  daughter: 'Daughter',
  parent: 'Parent',
  brother: 'Brother',
  sister: 'Sister',
  grandchild: 'Grandchild',
  grandparent: 'Grandparent',
  niece: 'Niece',
  nephew: 'Nephew',
  other_relative: 'Other Relative',
  friend: 'Friend',
  legal_representative: 'Legal Representative',
  other: 'Other',
};

export const NEXT_OF_KIN_RELATIONSHIP_OPTIONS = Object.entries(NEXT_OF_KIN_RELATIONSHIP_LABEL) as [
  NextOfKinRelationship,
  string,
][];
