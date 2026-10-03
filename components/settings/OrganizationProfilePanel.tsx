'use client';

import { useRef, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationProfile, useUpdateOrganizationProfile, useUpdatePrimaryLocationProfile } from '@/hooks/useOrganizationProfile';
import { useOrganizationBranding, useUploadBrandingLogo, useRemoveBrandingLogo } from '@/hooks/useOrganizationBranding';
import { OrganizationProfileValidationError, type OrganizationProfileFields, type PrimaryLocationFields } from '@/lib/organizationProfileClient';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { ConfirmActionDialog } from '@/components/settings/ConfirmActionDialog';

const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

const LOCATION_TYPE_OPTIONS: Array<{ value: PrimaryLocationFields['locationType']; label: string }> = [
  { value: 'office', label: 'Office' },
  { value: 'funeral_home', label: 'Funeral Home' },
  { value: 'crematory', label: 'Crematory' },
  { value: 'mailing_only', label: 'Mailing Only' },
];

/**
 * Settings → Organization Profile (2026-09). Two independent sections —
 * Organization and Primary Location — each with its own Save action, so a
 * failure in one never blocks or discards the other. Gated entirely
 * server-side by `organization.manage`; this component's own permission
 * check below is a UX nicety (avoids fetching/rendering data a caller
 * can't act on), never the authorization boundary — `GET`/`PATCH`
 * `/api/organization/profile` re-check independently and fail closed.
 *
 * No technical/configuration field (`organizationId`, `slug`, `status`,
 * `enabledModules`, `familyPortalEnabled`, `signatureRequestsEnabled`,
 * `requireMfa`, `defaultCurrency`, `timezone`, or any internal id) is
 * ever fetched, displayed, or editable here — see the API route's own
 * comment for why `timezone` specifically is withheld.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S1): restyled to the
 * `.sx-settings-section`/`.sx-form-grid`/`.sx-logo` system. This panel
 * renders as `{children}` inside `SettingsShell` (via the new
 * `app/(portal)/settings/layout.tsx`), which already owns the page's one
 * "Settings" title and `.sx-settings-head` — this component starts
 * directly with its own sections.
 */
export function OrganizationProfilePanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canManage = Boolean(permissionsQuery.data?.permissions.includes('organization.manage'));

  const profileQuery = useOrganizationProfile(canManage ? organizationId : '');

  if (permissionsQuery.isPending) {
    return <p className="sx-help">Loading…</p>;
  }

  if (!canManage) {
    return <p className="sx-help">You don&apos;t have access to Organization Profile.</p>;
  }

  if (profileQuery.isPending) {
    return (
      <div className="sx-loading" aria-busy="true">
        <span className="sx-skeleton" style={{ width: '90%' }} />
        <span className="sx-skeleton" style={{ width: '70%' }} />
        <span className="sx-skeleton" style={{ width: '80%' }} />
        <span className="sr-only">Loading organization profile…</span>
      </div>
    );
  }

  if (profileQuery.isError) {
    return <div className="sx-error-state" role="alert">{(profileQuery.error as Error).message}</div>;
  }

  const data = profileQuery.data;
  if (!data) return null;

  return (
    <div>
      <OrganizationSection organizationId={organizationId} initial={data.organization} />
      <PrimaryLocationSection organizationId={organizationId} initial={data.location} />
      <BrandingSection organizationName={data.organization.name} />
    </div>
  );
}

function fieldErrorMessage(error: unknown, field: string): string | null {
  if (error instanceof OrganizationProfileValidationError) {
    return error.fieldErrors.find((e) => e.field === field)?.message ?? null;
  }
  return null;
}

function OrganizationSection({ organizationId, initial }: { organizationId: string; initial: OrganizationProfileFields }) {
  const [form, setForm] = useState(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const mutation = useUpdateOrganizationProfile(organizationId);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavedAt(null);
    try {
      const updated = await mutation.mutateAsync(form);
      setForm(updated);
      setSavedAt(Date.now());
    } catch {
      // Entered values are intentionally left untouched on failure — the
      // error itself is read from mutation.error below.
    }
  }

  const error = mutation.isError ? mutation.error : null;
  const generalError = error && !(error instanceof OrganizationProfileValidationError) ? (error as Error).message : null;

  return (
    <section className="sx-settings-section">
      <div className="sx-settings-section-head">
        <div>
          <h3 className="sx-settings-section-title">Organization</h3>
        </div>
      </div>
      <form onSubmit={handleSave}>
        <div className="sx-form-grid">
          <div className="sx-field">
            <span className="sx-label">Organization Name</span>
            <TextField className="sx-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            {error && fieldErrorMessage(error, 'name') && <span className="sx-error">{fieldErrorMessage(error, 'name')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Legal Name</span>
            <TextField className="sx-input" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            {error && fieldErrorMessage(error, 'legalName') && <span className="sx-error">{fieldErrorMessage(error, 'legalName')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Primary Email</span>
            <TextField className="sx-input" type="email" value={form.primaryEmail} onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })} />
            {error && fieldErrorMessage(error, 'primaryEmail') && <span className="sx-error">{fieldErrorMessage(error, 'primaryEmail')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Primary Phone</span>
            <TextField className="sx-input" type="tel" value={form.primaryPhone} onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })} />
            {error && fieldErrorMessage(error, 'primaryPhone') && <span className="sx-error">{fieldErrorMessage(error, 'primaryPhone')}</span>}
          </div>

          <div className="sx-field sx-span-all">
            <span className="sx-label">Website</span>
            <TextField
              className="sx-input"
              type="url"
              placeholder="https://example.com"
              value={form.website ?? ''}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
            {error && fieldErrorMessage(error, 'website') && <span className="sx-error">{fieldErrorMessage(error, 'website')}</span>}
          </div>
        </div>

        {generalError && <div className="sx-form-banner sx-form-banner-error">{generalError}</div>}

        <div className="sx-save-row">
          <span className="sx-save-state" data-state={savedAt ? 'saved' : undefined}>{savedAt ? '✓ Saved' : ''}</span>
          <button type="submit" className="sx-btn sx-btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {savedAt && <p className="sr-only" role="status">Organization profile saved.</p>}
      </form>
    </section>
  );
}

function PrimaryLocationSection({ organizationId, initial }: { organizationId: string; initial: PrimaryLocationFields | null }) {
  if (!initial) {
    return (
      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Primary Location</h3>
        <div className="sx-error-state" role="alert">
          No primary location exists for this organization yet. Contact support to set one up before it can be managed
          here.
        </div>
      </section>
    );
  }

  return <PrimaryLocationForm organizationId={organizationId} initial={initial} />;
}

function PrimaryLocationForm({ organizationId, initial }: { organizationId: string; initial: PrimaryLocationFields }) {
  const [form, setForm] = useState(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const mutation = useUpdatePrimaryLocationProfile(organizationId);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavedAt(null);
    try {
      const updated = await mutation.mutateAsync(form);
      setForm(updated);
      setSavedAt(Date.now());
    } catch {
      // Entered values are intentionally left untouched on failure.
    }
  }

  const error = mutation.isError ? mutation.error : null;
  const generalError = error && !(error instanceof OrganizationProfileValidationError) ? (error as Error).message : null;

  return (
    <section className="sx-settings-section">
      <h3 className="sx-settings-section-title">Primary Location</h3>
      <form onSubmit={handleSave}>
        <div className="sx-form-grid">
          <div className="sx-field">
            <span className="sx-label">Location Name</span>
            <TextField className="sx-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            {error && fieldErrorMessage(error, 'name') && <span className="sx-error">{fieldErrorMessage(error, 'name')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Location Type</span>
            <SelectField className="sx-select" value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value })}>
              {LOCATION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </SelectField>
            {error && fieldErrorMessage(error, 'locationType') && <span className="sx-error">{fieldErrorMessage(error, 'locationType')}</span>}
          </div>

          <div className="sx-field sx-span-all">
            <span className="sx-label">Address Line 1</span>
            <TextField className="sx-input" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} required />
            {error && fieldErrorMessage(error, 'addressLine1') && <span className="sx-error">{fieldErrorMessage(error, 'addressLine1')}</span>}
          </div>

          <div className="sx-field sx-span-all">
            <span className="sx-label">Address Line 2</span>
            <TextField className="sx-input" value={form.addressLine2 ?? ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
          </div>

          <div className="sx-form-grid-3 sx-span-all" style={{ display: 'grid', columnGap: 16, rowGap: 14 }}>
            <div className="sx-field">
              <span className="sx-label">City</span>
              <TextField className="sx-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
              {error && fieldErrorMessage(error, 'city') && <span className="sx-error">{fieldErrorMessage(error, 'city')}</span>}
            </div>

            <div className="sx-field">
              <span className="sx-label">State</span>
              <TextField className="sx-input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required />
              {error && fieldErrorMessage(error, 'state') && <span className="sx-error">{fieldErrorMessage(error, 'state')}</span>}
            </div>

            <div className="sx-field">
              <span className="sx-label">Postal Code</span>
              <TextField className="sx-input" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} required />
              {error && fieldErrorMessage(error, 'postalCode') && <span className="sx-error">{fieldErrorMessage(error, 'postalCode')}</span>}
            </div>
          </div>

          <div className="sx-field">
            <span className="sx-label">Country</span>
            <TextField className="sx-input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required />
            {error && fieldErrorMessage(error, 'country') && <span className="sx-error">{fieldErrorMessage(error, 'country')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Phone</span>
            <TextField className="sx-input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            {error && fieldErrorMessage(error, 'phone') && <span className="sx-error">{fieldErrorMessage(error, 'phone')}</span>}
          </div>

          <div className="sx-field">
            <span className="sx-label">Email</span>
            <TextField className="sx-input" type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {error && fieldErrorMessage(error, 'email') && <span className="sx-error">{fieldErrorMessage(error, 'email')}</span>}
          </div>
        </div>

        {generalError && <div className="sx-form-banner sx-form-banner-error">{generalError}</div>}

        <div className="sx-save-row">
          <span className="sx-save-state" data-state={savedAt ? 'saved' : undefined}>{savedAt ? '✓ Saved' : ''}</span>
          <button type="submit" className="sx-btn sx-btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {savedAt && <p className="sr-only" role="status">Primary location saved.</p>}
      </form>
    </section>
  );
}

/**
 * Organization Branding Settings phase — logo only (colors/fonts/themes/
 * email branding/favicon/statement customization deliberately out of
 * scope for this pass, per that phase's own instruction). Rendered only
 * inside the already-`organization.manage`-gated parent panel above — no
 * second permission check here, matching `OrganizationSection`/
 * `PrimaryLocationSection`'s own precedent of trusting the parent's gate
 * (the real enforcement is server-side on the upload/remove routes
 * regardless of what this component renders).
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5: "Change logo"/"Upload logo"
 * are the spec's own literal button labels (sentence case) — renamed from
 * the prior "Change Logo"/"Upload Logo"; OrganizationProfilePanel.test.tsx
 * updated accordingly (see this fork's report).
 */
function BrandingSection({ organizationName }: { organizationName: string }) {
  const brandingQuery = useOrganizationBranding();
  const uploadLogo = useUploadBrandingLogo();
  const removeLogo = useRemoveBrandingLogo();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const logoUrl = brandingQuery.data?.logoUrl ?? null;

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalError(null);
    setSavedAt(null);
    try {
      await uploadLogo.mutateAsync(file);
      setSavedAt(Date.now());
    } catch (error) {
      // The branding record is never optimistically changed above, so a
      // failed upload leaves the previously-displayed logo (or no-logo
      // state) exactly as it was — never a UI that claims success while
      // persistence failed.
      setLocalError(error instanceof Error ? error.message : 'Failed to upload logo.');
    }
  }

  async function handleRemove() {
    setLocalError(null);
    setSavedAt(null);
    try {
      await removeLogo.mutateAsync();
      setSavedAt(Date.now());
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Failed to remove logo.');
      throw error; // surfaced inline by ConfirmActionDialog too
    }
  }

  const pending = uploadLogo.isPending || removeLogo.isPending;

  return (
    <section className="sx-settings-section">
      <h3 className="sx-settings-section-title">Organization Branding</h3>

      {brandingQuery.isPending ? (
        <p className="sx-help">Loading…</p>
      ) : (
        <>
          <span className="sx-label">Logo</span>
          <div className="sx-logo" style={{ marginTop: 6 }}>
            <div className="sx-logo-preview" data-empty={logoUrl ? undefined : true}>
              {logoUrl ? <img src={logoUrl} alt={`${organizationName} logo`} /> : <span>No logo</span>}
            </div>
            <div>
              {!logoUrl && <p className="sx-help" style={{ margin: '0 0 8px' }}>No organization logo uploaded.</p>}

              <input
                ref={fileInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                aria-label="Upload organization logo"
                className="sr-only"
                onChange={handleFileSelected}
              />

              <div className="sx-logo-actions">
                <button type="button" className="sx-btn sx-btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={pending}>
                  {uploadLogo.isPending ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
                </button>
                {logoUrl && (
                  <button type="button" className="sx-btn sx-btn-ghost" style={{ color: 'var(--sx-red)' }} onClick={() => setRemoveConfirmOpen(true)} disabled={pending}>
                    Remove Logo
                  </button>
                )}
              </div>

              <p className="sx-help" style={{ margin: '8px 0 0' }} role="note">
                PNG, JPEG, or WEBP. Up to 5MB.
              </p>

              {localError && (
                <div className="sx-error-state" role="alert" style={{ marginTop: 8 }}>
                  {localError}
                </div>
              )}
              {savedAt && !localError && (
                <p className="sr-only" role="status">
                  Logo updated.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <ConfirmActionDialog
        open={removeConfirmOpen}
        onClose={() => setRemoveConfirmOpen(false)}
        title="Remove Logo"
        message="This organization's logo will be removed from the sidebar. You can upload a new one at any time."
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </section>
  );
}
