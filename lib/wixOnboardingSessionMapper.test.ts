import { describe, expect, it } from 'vitest';
import {
  applyOnboardingSessionUpdateToWixData,
  buildWixOnboardingSessionData,
  mapWixOnboardingSessionItem,
} from './wixOnboardingSessionMapper';
import type { OnboardingSession } from '../types/onboarding';

const SESSION: OnboardingSession = {
  id: 'session-1',
  organizationId: 'org-1',
  status: 'in_progress',
  currentStep: 'primary_location',
  completedSteps: ['organization_profile'],
  startedByUserId: 'mock-user-dana',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  lastSavedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('mapWixOnboardingSessionItem', () => {
  it('round-trips through build then map', () => {
    expect(mapWixOnboardingSessionItem(buildWixOnboardingSessionData(SESSION))).toEqual(SESSION);
  });

  it('rejects an invalid status value', () => {
    expect(mapWixOnboardingSessionItem({ ...buildWixOnboardingSessionData(SESSION), status: 'bogus' } as never)).toBeNull();
  });

  it('rejects an invalid currentStep value', () => {
    expect(mapWixOnboardingSessionItem({ ...buildWixOnboardingSessionData(SESSION), currentStep: 'bogus' } as never)).toBeNull();
  });

  it('rejects a completedSteps array containing an invalid step', () => {
    const data = { ...buildWixOnboardingSessionData(SESSION), completedSteps: ['organization_profile', 'bogus'] };
    expect(mapWixOnboardingSessionItem(data as never)).toBeNull();
  });

  it('accepts an empty completedSteps array (a freshly-started session)', () => {
    const data = { ...buildWixOnboardingSessionData(SESSION), completedSteps: [] };
    expect(mapWixOnboardingSessionItem(data as never)?.completedSteps).toEqual([]);
  });

  it('maps completedAt to null when absent', () => {
    const data = { ...buildWixOnboardingSessionData(SESSION) };
    delete (data as Record<string, unknown>).completedAt;
    expect(mapWixOnboardingSessionItem(data as never)?.completedAt).toBeNull();
  });
});

describe('applyOnboardingSessionUpdateToWixData', () => {
  it('applies a partial patch without disturbing other fields', () => {
    const existing = buildWixOnboardingSessionData(SESSION);
    const merged = applyOnboardingSessionUpdateToWixData(existing, {
      status: 'completed',
      completedSteps: ['organization_profile', 'primary_location'],
      completedAt: '2026-02-01T00:00:00.000Z',
      version: 2,
    });
    const mapped = mapWixOnboardingSessionItem(merged);
    expect(mapped?.status).toBe('completed');
    expect(mapped?.completedSteps).toEqual(['organization_profile', 'primary_location']);
    expect(mapped?.completedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(mapped?.version).toBe(2);
    expect(mapped?.startedByUserId).toBe('mock-user-dana'); // untouched
  });
});
