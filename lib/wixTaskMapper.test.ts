import { describe, expect, it } from 'vitest';
import { mapWixTaskItem } from './wixTaskMapper';

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
