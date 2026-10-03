'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useResources, useCreateResource, useSetResourceStatus } from '@/hooks/useResources';
import { useAppointments } from '@/hooks/useAppointments';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { Checkbox } from '@/components/ui/Checkbox';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { RESOURCE_STATUS_LABEL, resourceStatusVariant, APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { formatAppointmentTime, getWeekDays, isSameDay, addDays, getCalendarRange } from '@/utils/scheduling';
import type { ResourceType, ResourceStatus } from '@/types/resource';

const RESOURCE_TYPES: ResourceType[] = [
  'funeral_director',
  'staff',
  'vehicle',
  'chapel',
  'viewing_room',
  'meeting_room',
  'crematory',
  'cemetery',
  'equipment',
  'external_vendor',
];
const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  funeral_director: 'Funeral Director',
  staff: 'Staff',
  vehicle: 'Vehicle',
  chapel: 'Chapel',
  viewing_room: 'Viewing Room',
  meeting_room: 'Meeting Room',
  crematory: 'Crematory',
  cemetery: 'Cemetery',
  equipment: 'Equipment',
  external_vendor: 'External Vendor',
};
const RESOURCE_STATUSES: ResourceStatus[] = ['active', 'maintenance', 'out_of_service', 'archived'];

/** sx-status has no neutral/warning-free variant for resource status, whose
    5-way vocabulary (active/maintenance/out_of_service/archived) doesn't
    map 1:1 onto the Badge-style success/brand/danger/neutral variants this
    file used before — kept as the closest sx-status modifier per state. */
function resourceStatusClass(status: ResourceStatus): string {
  const variant = resourceStatusVariant(status);
  if (variant === 'success') return 'sx-status sx-status-ok';
  if (variant === 'danger') return 'sx-status sx-status-bad';
  if (variant === 'brand') return 'sx-status sx-status-info';
  return 'sx-status';
}
function appointmentStatusClass(status: Parameters<typeof appointmentStatusVariant>[0]): string {
  const variant = appointmentStatusVariant(status);
  if (variant === 'success') return 'sx-status sx-status-ok';
  if (variant === 'danger') return 'sx-status sx-status-bad';
  if (variant === 'brand') return 'sx-status sx-status-info';
  return 'sx-status';
}

/**
 * Phase 27 (Scheduling & Resource Management). "Settings > Resources" —
 * create/manage bookable resources and change their lifecycle status, plus
 * a per-resource week grid (the "Resource Calendar"), reusing the same
 * week-projection logic as the org-wide Calendar page's own Week view.
 * Unlike Team/Roles/Audit/Document Templates, this page is not
 * identity-mode-gated — resource management works identically under every
 * `AUTH_ADAPTER`, since its routes authorize via `requireAuthorizedOrganization`
 * + `resource.manage`/`schedule.read`, not `requireIdentitySession`.
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.6: light-touch restyle (settings
 * head/section wrappers, form-system classes, sx-btn variants) — not a
 * full redesign, per that section's own instruction.
 */
export function ResourceManagementPanel() {
  const { organizationId } = useOrganization();
  const resourcesQuery = useResources(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const createResource = useCreateResource(organizationId);
  const setStatus = useSetResourceStatus(organizationId);

  const [createOpen, setCreateOpen] = useState(false);
  const [resourceType, setResourceType] = useState<ResourceType>('chapel');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [isExternal, setIsExternal] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const permissions = myPermissionsQuery.isSuccess ? myPermissionsQuery.data.permissions : null;
  const canManage = permissions === null || permissions.includes('resource.manage');

  const range = useMemo(() => getCalendarRange('week', weekAnchor), [weekAnchor]);
  const resourceAppointmentsQuery = useAppointments(organizationId, { from: range.from, to: range.to, resourceId: selectedResourceId ?? undefined });

  if (resourcesQuery.isPending) return <p className="sx-help">Loading resources…</p>;
  if (resourcesQuery.isError) return <div className="sx-error-state" role="alert">Couldn&rsquo;t load resources. Please try again.</div>;

  const resources = resourcesQuery.data ?? [];
  const selectedResource = resources.find((r) => r.id === selectedResourceId) ?? null;
  const weekAppointments = resourceAppointmentsQuery.data ?? [];
  const weekDays = getWeekDays(weekAnchor);

  function resetForm() {
    setResourceType('chapel');
    setName('');
    setCapacity('');
    setIsExternal(false);
    setNotes('');
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    try {
      await createResource.mutateAsync({
        resourceType,
        name: name.trim(),
        capacity: capacity ? Number(capacity) : undefined,
        isExternal,
        notes: notes.trim() || undefined,
      });
      setCreateOpen(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the resource.');
    }
  }

  return (
    <div>
      <div className="sx-settings-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h2 className="sx-settings-title">Resources</h2>
        {canManage && (
          <button
            type="button"
            className="sx-btn sx-btn-primary"
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            New Resource
          </button>
        )}
      </div>

      {resources.length === 0 ? (
        <EmptyState message="No resources have been created for this organization yet." />
      ) : (
        <section className="sx-settings-section">
          {resources.map((resource) => (
            <div key={resource.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, borderBottom: '1px solid var(--sx-border-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sx-cell-title" style={{ display: 'block' }}>{resource.name}</span>
                <span className="sx-cell-sub">
                  {RESOURCE_TYPE_LABEL[resource.resourceType]}
                  {resource.isExternal ? ' · External (never conflict-checked)' : ''}
                </span>
              </div>
              <span className={resourceStatusClass(resource.status)}>{RESOURCE_STATUS_LABEL[resource.status]}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {canManage && (
                  <SelectField
                    className="sx-select"
                    value={resource.status}
                    onChange={(e) => setStatus.mutate({ resourceId: resource.id, status: e.target.value as ResourceStatus })}
                    aria-label={`Change status for ${resource.name}`}
                  >
                    {RESOURCE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {RESOURCE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </SelectField>
                )}
                <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setSelectedResourceId(resource.id)}>
                  View Calendar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {selectedResource && (
        <section className="sx-settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 className="sx-settings-section-title">{selectedResource.name}&rsquo;s Week</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setWeekAnchor((d) => addDays(d, -7))}>
                ← Prev
              </button>
              <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setWeekAnchor(new Date())}>
                This Week
              </button>
              <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setWeekAnchor((d) => addDays(d, 7))}>
                Next →
              </button>
              <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setSelectedResourceId(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="sx-week">
            {weekDays.map((day) => {
              const dayAppointments = weekAppointments.filter((a) => isSameDay(new Date(a.startAt), day)).sort((a, b) => a.startAt.localeCompare(b.startAt));
              return (
                <div key={day.toISOString()} className="sx-week-col">
                  <div className="sx-week-head">
                    <span className="sx-week-dow">{day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="sx-week-body">
                    {dayAppointments.length === 0 ? (
                      <span className="sx-week-empty">—</span>
                    ) : (
                      dayAppointments.map((a) => (
                        <div key={a.id} className="sx-chip" style={{ cursor: 'default' }}>
                          <span>
                            {formatAppointmentTime(a.startAt, a.timezone)} {a.title}
                          </span>
                          <span className={appointmentStatusClass(a.status)} style={{ marginLeft: 'auto' }}>{APPOINTMENT_STATUS_LABEL[a.status]}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Resource">
        <div className="sx-form-grid">
          <div className="sx-field">
            <label className="sx-label" htmlFor="resource-type">
              Type
            </label>
            <SelectField className="sx-select" id="resource-type" value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RESOURCE_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="sx-field">
            <label className="sx-label" htmlFor="resource-name">
              Name
            </label>
            <TextField className="sx-input" id="resource-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="sx-field">
            <label className="sx-label" htmlFor="resource-capacity">
              Capacity (optional)
            </label>
            <TextField className="sx-input" id="resource-capacity" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <label className="sx-check sx-span-all">
            <Checkbox checked={isExternal} onChange={() => setIsExternal((v) => !v)} aria-label="External vendor" />
            <span>External vendor (never conflict-checked)</span>
          </label>
          <div className="sx-field sx-span-all">
            <label className="sx-label" htmlFor="resource-notes">
              Notes
            </label>
            <TextArea className="sx-textarea" id="resource-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        {error && <div className="sx-form-banner sx-form-banner-error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="sx-modal-footer" style={{ padding: 0, border: 'none', height: 'auto', marginTop: 16 }}>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setCreateOpen(false)}>
            Cancel
          </button>
          <button type="button" className="sx-btn sx-btn-primary" onClick={handleCreate} disabled={!name.trim() || createResource.isPending}>
            {createResource.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
