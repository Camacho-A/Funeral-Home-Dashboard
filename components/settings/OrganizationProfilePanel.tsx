'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useOrganizationProfile, useUpdateOrganizationProfile, useUpdatePrimaryLocationProfile } from '@/hooks/useOrganizationProfile';
import { OrganizationProfileValidationError, type OrganizationProfileFields, type PrimaryLocationFields } from '@/lib/organizationProfileClient';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import styles from './OrganizationProfilePanel.module.css';

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
 */
export function OrganizationProfilePanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canManage = Boolean(permissionsQuery.data?.permissions.includes('organization.manage'));

  const profileQuery = useOrganizationProfile(canManage ? organizationId : '');

  if (permissionsQuery.isPending) {
    return <p className={styles.description}>Loading…</p>;
  }

  if (!canManage) {
    return <p className={styles.description}>You don&apos;t have access to Organization Profile.</p>;
  }

  if (profileQuery.isPending) {
    return <p className={styles.description}>Loading organization profile…</p>;
  }

  if (profileQuery.isError) {
    return <p className={styles.error}>{(profileQuery.error as Error).message}</p>;
  }

  const data = profileQuery.data;
  if (!data) return null;

  return (
    <div>
      <OrganizationSection organizationId={organizationId} initial={data.organization} />
      <PrimaryLocationSection organizationId={organizationId} initial={data.location} />
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
    <Card className={styles.section}>
      <h2 className={styles.sectionTitle}>Organization</h2>
      <form onSubmit={handleSave}>
        <label className={styles.field}>
          <span className={styles.label}>Organization Name</span>
          <TextField value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {error && fieldErrorMessage(error, 'name') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'name')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Legal Name</span>
          <TextField value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          {error && fieldErrorMessage(error, 'legalName') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'legalName')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Primary Email</span>
          <TextField type="email" value={form.primaryEmail} onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })} />
          {error && fieldErrorMessage(error, 'primaryEmail') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'primaryEmail')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Primary Phone</span>
          <TextField type="tel" value={form.primaryPhone} onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })} />
          {error && fieldErrorMessage(error, 'primaryPhone') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'primaryPhone')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Website</span>
          <TextField
            type="url"
            placeholder="https://example.com"
            value={form.website ?? ''}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
          {error && fieldErrorMessage(error, 'website') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'website')}</span>}
        </label>

        {generalError && <p className={styles.error}>{generalError}</p>}
        {savedAt && <p className={styles.success}>Organization profile saved.</p>}

        <div className={styles.footer}>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PrimaryLocationSection({ organizationId, initial }: { organizationId: string; initial: PrimaryLocationFields | null }) {
  if (!initial) {
    return (
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>Primary Location</h2>
        <p className={styles.error}>
          No primary location exists for this organization yet. Contact support to set one up before it can be managed
          here.
        </p>
      </Card>
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
    <Card className={styles.section}>
      <h2 className={styles.sectionTitle}>Primary Location</h2>
      <form onSubmit={handleSave}>
        <label className={styles.field}>
          <span className={styles.label}>Location Name</span>
          <TextField value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {error && fieldErrorMessage(error, 'name') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'name')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Location Type</span>
          <SelectField value={form.locationType} onChange={(e) => setForm({ ...form, locationType: e.target.value })}>
            {LOCATION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>
          {error && fieldErrorMessage(error, 'locationType') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'locationType')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Address Line 1</span>
          <TextField value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} required />
          {error && fieldErrorMessage(error, 'addressLine1') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'addressLine1')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Address Line 2</span>
          <TextField value={form.addressLine2 ?? ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>City</span>
          <TextField value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
          {error && fieldErrorMessage(error, 'city') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'city')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>State</span>
          <TextField value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required />
          {error && fieldErrorMessage(error, 'state') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'state')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Postal Code</span>
          <TextField value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} required />
          {error && fieldErrorMessage(error, 'postalCode') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'postalCode')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Country</span>
          <TextField value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required />
          {error && fieldErrorMessage(error, 'country') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'country')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Phone</span>
          <TextField type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          {error && fieldErrorMessage(error, 'phone') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'phone')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <TextField type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {error && fieldErrorMessage(error, 'email') && <span className={styles.fieldError}>{fieldErrorMessage(error, 'email')}</span>}
        </label>

        {generalError && <p className={styles.error}>{generalError}</p>}
        {savedAt && <p className={styles.success}>Primary location saved.</p>}

        <div className={styles.footer}>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
