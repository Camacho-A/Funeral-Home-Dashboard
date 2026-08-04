'use client';

import { useMemo, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useResources, useCreateResource, useSetResourceStatus } from '@/hooks/useResources';
import { useAppointments } from '@/hooks/useAppointments';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { Checkbox } from '@/components/ui/Checkbox';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { RESOURCE_STATUS_LABEL, resourceStatusVariant, APPOINTMENT_STATUS_LABEL, appointmentStatusVariant } from '@/domain/scheduling/appointmentDisplay';
import { formatAppointmentTime, getWeekDays, isSameDay, addDays, getCalendarRange } from '@/utils/scheduling';
import type { ResourceType, ResourceStatus } from '@/types/resource';
import styles from './ResourceManagementPanel.module.css';

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

/**
 * Phase 27 (Scheduling & Resource Management). "Settings > Resources" —
 * create/manage bookable resources and change their lifecycle status, plus
 * a per-resource week grid (the "Resource Calendar"), reusing the same
 * week-projection logic as the org-wide Calendar page's own Week view.
 * Unlike Team/Roles/Audit/Document Templates, this page is not
 * identity-mode-gated — resource management works identically under every
 * `AUTH_ADAPTER`, since its routes authorize via `requireAuthorizedOrganization`
 * + `resource.manage`/`schedule.read`, not `requireIdentitySession`.
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

  if (resourcesQuery.isPending) return <p className={styles.loading}>Loading resources…</p>;
  if (resourcesQuery.isError) return <p className={styles.errorText}>Couldn&rsquo;t load resources. Please try again.</p>;

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
    <div className={styles.card}>
      <div className={styles.toolbar}>
        {canManage && (
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            New Resource
          </Button>
        )}
      </div>

      {resources.length === 0 ? (
        <EmptyState message="No resources have been created for this organization yet." />
      ) : (
        <Card className={styles.listCard}>
          <div className={styles.list}>
            {resources.map((resource) => (
              <div key={resource.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.name}>{resource.name}</span>
                  <span className={styles.meta}>
                    {RESOURCE_TYPE_LABEL[resource.resourceType]}
                    {resource.isExternal ? ' · External (never conflict-checked)' : ''}
                  </span>
                </div>
                <Badge variant={resourceStatusVariant(resource.status)}>{RESOURCE_STATUS_LABEL[resource.status]}</Badge>
                <div className={styles.actions}>
                  {canManage && (
                    <SelectField
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
                  <Button variant="secondary" onClick={() => setSelectedResourceId(resource.id)}>
                    View Calendar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {selectedResource && (
        <div className={styles.calendarSection}>
          <div className={styles.calendarHeader}>
            <h3 className={styles.calendarTitle}>{selectedResource.name}&rsquo;s Week</h3>
            <div className={styles.navGroup}>
              <Button variant="ghost" onClick={() => setWeekAnchor((d) => addDays(d, -7))}>
                ← Prev
              </Button>
              <Button variant="ghost" onClick={() => setWeekAnchor(new Date())}>
                This Week
              </Button>
              <Button variant="ghost" onClick={() => setWeekAnchor((d) => addDays(d, 7))}>
                Next →
              </Button>
              <Button variant="ghost" onClick={() => setSelectedResourceId(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className={styles.weekGrid}>
            {weekDays.map((day) => {
              const dayAppointments = weekAppointments.filter((a) => isSameDay(new Date(a.startAt), day)).sort((a, b) => a.startAt.localeCompare(b.startAt));
              return (
                <div key={day.toISOString()} className={styles.weekColumn}>
                  <div className={styles.weekColumnHeader}>{day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</div>
                  {dayAppointments.length === 0 ? (
                    <span className={styles.weekEmpty}>—</span>
                  ) : (
                    dayAppointments.map((a) => (
                      <div key={a.id} className={styles.weekChip}>
                        <span>
                          {formatAppointmentTime(a.startAt, a.timezone)} {a.title}
                        </span>
                        <Badge variant={appointmentStatusVariant(a.status)}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Resource">
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="resource-type">
              Type
            </label>
            <SelectField id="resource-type" value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RESOURCE_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="resource-name">
              Name
            </label>
            <TextField id="resource-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="resource-capacity">
              Capacity (optional)
            </label>
            <TextField id="resource-capacity" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <label className={styles.inlineCheckbox}>
            <Checkbox checked={isExternal} onChange={() => setIsExternal((v) => !v)} aria-label="External vendor" />
            <span>External vendor (never conflict-checked)</span>
          </label>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="resource-notes">
              Notes
            </label>
            <TextArea id="resource-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {error && <span className={styles.error}>{error}</span>}
          <div className={styles.formActions}>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} disabled={!name.trim() || createResource.isPending}>
              {createResource.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
