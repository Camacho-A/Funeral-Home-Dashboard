/** Unified portal (Phase 5N): shown when an address names an organization the person does not belong to. Says nothing about whether the record exists. */
export function OrganizationAccessDenied() {
  return (
    <div role="alert" data-testid="organization-access-denied" style={{ padding: '24px 16px' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>You don&rsquo;t have access to this organization</h1>
      <p style={{ margin: 0 }}>This record belongs to an organization you are not a member of. Ask its administrator if you need access.</p>
    </div>
  );
}
