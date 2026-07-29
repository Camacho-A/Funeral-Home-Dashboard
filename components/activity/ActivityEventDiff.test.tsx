import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityEventDiff } from './ActivityEventDiff';
import type { ActivityEvent } from '@/types/activityEvent';

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'event-1',
    eventVersion: 1,
    organizationId: 'org-1',
    caseId: 'case-1',
    actorIdentityId: 'identity-1',
    actorMembershipId: null,
    actorRoleKey: 'administrator',
    category: 'cases',
    eventType: 'case.updated',
    resourceType: 'case',
    resourceId: 'case-1',
    previousValue: null,
    newValue: null,
    description: 'Case updated',
    metadata: null,
    severity: 'info',
    correlationId: null,
    isSystemGenerated: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ActivityEventDiff', () => {
  it('renders nothing when neither previousValue nor newValue is present', () => {
    const { container } = render(<ActivityEventDiff event={makeEvent()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a before/after row for each changed field, union of both sides', () => {
    render(
      <ActivityEventDiff
        event={makeEvent({
          previousValue: JSON.stringify({ stage: 'arrangement' }),
          newValue: JSON.stringify({ stage: 'service_scheduled' }),
        })}
      />,
    );
    expect(screen.getByText('stage')).toBeInTheDocument();
    expect(screen.getByText('arrangement')).toBeInTheDocument();
    expect(screen.getByText('service_scheduled')).toBeInTheDocument();
  });

  it('renders a creation event with newValue only (no previous side)', () => {
    render(<ActivityEventDiff event={makeEvent({ previousValue: null, newValue: JSON.stringify({ caseNumber: 'CR-2026-0001' }) })} />);
    expect(screen.getByText('caseNumber')).toBeInTheDocument();
    expect(screen.getByText('CR-2026-0001')).toBeInTheDocument();
  });

  it('does not blow up on malformed JSON — treats it as absent', () => {
    const { container } = render(<ActivityEventDiff event={makeEvent({ previousValue: 'not json', newValue: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
