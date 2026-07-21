/**
 * The trusted, authenticated-user context — distinct from OrganizationContext
 * (which tenant), this is *who*. Obtained only via useSession() (see
 * hooks/useSession.ts), never accepted as client-editable form input. Lives
 * in types/ rather than hooks/ so services/ can depend on it without
 * inverting the domain → services → hooks → components layering
 * (services/casesService.ts needs this shape for intake-owner derivation;
 * it must not import from hooks/).
 */
export type Session = {
  staffId: string;
  displayName: string;
};
