import { describe, expect, it } from 'vitest';
import {
  mapWixTaskItem,
  buildWixTaskData,
  validateAndPickTaskUpdate,
  applyTaskUpdateToWixData,
} from './wixTaskMapper';

const validItem = {
  beaconTaskId: 'task-1',
  organizationId: 'managed-cremations',
  text: "Call ME's office re: George Alvarez release",
  assigneeId: 'staff-priya',
  isDone: false,
  caseId: '1046',
  createdAt: '2026-07-14T00:00:00.000Z',
  _id: 'some-random-wix-guid',
  _createdDate: '2026-07-14T00:00:00.000Z',
};

describe('mapWixTaskItem', () => {
  it('maps a well-formed item to the CaseTask domain shape, applying the documented rename', () => {
    const result = mapWixTaskItem(validItem);

    expect(result).toMatchObject({
      id: 'task-1',
      organizationId: 'managed-cremations',
      text: "Call ME's office re: George Alvarez release",
      assigneeStaffId: 'staff-priya', // from assigneeId
      isDone: false,
      caseId: '1046',
      createdAt: '2026-07-14T00:00:00.000Z',
    });
  });

  it('never uses the Wix system _id as the task id', () => {
    const result = mapWixTaskItem(validItem);
    expect(result?.id).toBe('task-1');
    expect(result?.id).not.toBe('some-random-wix-guid');
  });

  it('allows caseId to be null, representing a general office task', () => {
    const result = mapWixTaskItem({ ...validItem, caseId: null });
    expect(result?.caseId).toBeNull();
  });

  it('allows assigneeId to be null or absent (unassigned task)', () => {
    expect(mapWixTaskItem({ ...validItem, assigneeId: null })?.assigneeStaffId).toBeNull();
    const { assigneeId, ...withoutAssignee } = validItem;
    void assigneeId;
    expect(mapWixTaskItem(withoutAssignee)?.assigneeStaffId).toBeNull();
  });

  it('maps isDone: true correctly', () => {
    const result = mapWixTaskItem({ ...validItem, isDone: true });
    expect(result?.isDone).toBe(true);
  });

  it('returns null when the item is undefined', () => {
    expect(mapWixTaskItem(undefined)).toBeNull();
  });

  it('returns null when a required field is missing or the wrong type', () => {
    expect(mapWixTaskItem({ ...validItem, beaconTaskId: undefined })).toBeNull();
    expect(mapWixTaskItem({ ...validItem, organizationId: 123 })).toBeNull();
    expect(mapWixTaskItem({ ...validItem, text: undefined })).toBeNull();
    expect(mapWixTaskItem({ ...validItem, isDone: 'false' })).toBeNull();
    expect(mapWixTaskItem({ ...validItem, createdAt: undefined })).toBeNull();
  });

  it('returns null when assigneeId or caseId is present but the wrong type', () => {
    expect(mapWixTaskItem({ ...validItem, assigneeId: 42 })).toBeNull();
    expect(mapWixTaskItem({ ...validItem, caseId: 42 })).toBeNull();
  });

  it('does not invent or map any status/priority/due-date field — none exist on CaseTask', () => {
    const result = mapWixTaskItem(validItem);
    expect(result).not.toHaveProperty('dueDate');
    expect(result).not.toHaveProperty('priority');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('completedAt');
  });
});

describe('buildWixTaskData', () => {
  it('builds a complete Wix tasks item, round-trippable through mapWixTaskItem', () => {
    const data = buildWixTaskData({
      beaconTaskId: 'new-task-1',
      organizationId: 'managed-cremations',
      text: 'New task',
      assigneeStaffId: 'staff-dana',
      caseId: '1046',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    const mapped = mapWixTaskItem(data);

    expect(mapped).not.toBeNull();
    expect(mapped?.id).toBe('new-task-1');
    expect(mapped?.assigneeStaffId).toBe('staff-dana');
    expect(mapped?.isDone).toBe(false);
    expect(mapped?.caseId).toBe('1046');
  });

  it('defaults a new task to isDone: false', () => {
    const data = buildWixTaskData({
      beaconTaskId: 'x',
      organizationId: 'managed-cremations',
      text: 'x',
      assigneeStaffId: null,
      caseId: null,
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    expect(data.isDone).toBe(false);
  });
});

describe('validateAndPickTaskUpdate', () => {
  it('picks only known, correctly-typed fields', () => {
    const { patch, errors } = validateAndPickTaskUpdate({ text: 'Renamed', isDone: true });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ text: 'Renamed', isDone: true });
  });

  it('silently drops immutable/unknown fields even when present in the body', () => {
    const { patch, errors } = validateAndPickTaskUpdate({
      text: 'Renamed',
      organizationId: 'evergreen-memorial-group',
      caseId: 'forged-case-id',
      id: 'forged-id',
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ text: 'Renamed' });
  });

  it('rejects a present-but-wrong-typed field rather than silently dropping or coercing it', () => {
    const { patch, errors } = validateAndPickTaskUpdate({ isDone: 'yes', text: 42 });
    expect(errors).toContain('isDone');
    expect(errors).toContain('text');
    expect(patch).toEqual({});
  });

  it('allows assigneeStaffId to be null (unassigning a task)', () => {
    const { patch, errors } = validateAndPickTaskUpdate({ assigneeStaffId: null });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ assigneeStaffId: null });
  });

  it('returns an error for a non-object body', () => {
    expect(validateAndPickTaskUpdate(null).errors.length).toBeGreaterThan(0);
  });
});

describe('applyTaskUpdateToWixData', () => {
  it('merges a patch onto the existing data, preserving every untouched field', () => {
    const existing = { ...validItem };
    const result = applyTaskUpdateToWixData(existing, { text: 'Renamed' });

    expect(result.text).toBe('Renamed');
    expect(result.organizationId).toBe(existing.organizationId);
    expect(result.caseId).toBe(existing.caseId);
  });

  it('renames assigneeStaffId to assigneeId', () => {
    const existing = { ...validItem };
    const result = applyTaskUpdateToWixData(existing, { assigneeStaffId: 'staff-new' });
    expect(result.assigneeId).toBe('staff-new');
  });

  it('does not mutate the original existing object', () => {
    const existing = { ...validItem };
    applyTaskUpdateToWixData(existing, { text: 'Renamed' });
    expect(existing.text).toBe(validItem.text);
  });
});
