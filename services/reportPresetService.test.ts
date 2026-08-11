import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { reportPresetFixtures } from './__mocks__/reportingFixtures';
import { list, create, remove, ReportPresetServiceError } from './reportPresetService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `preset-test-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
  reportPresetFixtures.length = 0;
});

describe('create', () => {
  it('creates a private preset owned by the caller', async () => {
    const preset = await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'My view', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    expect(preset.isShared).toBe(false);
    expect(preset.ownerIdentityId).toBe('identity-1');
    expect(reportPresetFixtures).toHaveLength(1);
  });

  it('refuses to save a shared preset without dashboard.manage', async () => {
    await expect(
      create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Org view', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, isShared: true, idFactory }, 'mock'),
    ).rejects.toThrow(ReportPresetServiceError);
  });

  it('allows a shared preset with dashboard.manage', async () => {
    const preset = await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Org view', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: true, isShared: true, idFactory }, 'mock');
    expect(preset.isShared).toBe(true);
  });
});

describe('list', () => {
  it('returns the caller\'s own presets and any shared preset, never another owner\'s private preset', async () => {
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Mine', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Someone else\'s private', filters: '{}', ownerIdentityId: 'identity-2', canManageDashboard: false, idFactory }, 'mock');
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Shared', filters: '{}', ownerIdentityId: 'identity-2', canManageDashboard: true, isShared: true, idFactory }, 'mock');

    const visible = await list(DEFAULT_ORGANIZATION_ID, 'identity-1', {}, 'mock');
    expect(visible.map((p) => p.name).sort()).toEqual(['Mine', 'Shared']);
  });

  it('is isolated per organization', async () => {
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Org A preset', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    const visible = await list(SECOND_MOCK_ORGANIZATION_ID, 'identity-1', {}, 'mock');
    expect(visible).toEqual([]);
  });

  it('narrows by reportKey', async () => {
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'A', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'trial-balance', name: 'B', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    const visible = await list(DEFAULT_ORGANIZATION_ID, 'identity-1', { reportKey: 'active-cases' }, 'mock');
    expect(visible.map((p) => p.name)).toEqual(['A']);
  });
});

describe('remove', () => {
  it('removes the caller\'s own preset', async () => {
    const preset = await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Mine', filters: '{}', ownerIdentityId: 'identity-1', canManageDashboard: false, idFactory }, 'mock');
    await remove(DEFAULT_ORGANIZATION_ID, preset.id, { identityId: 'identity-1', canManageDashboard: false }, 'mock');
    expect(reportPresetFixtures).toHaveLength(0);
  });

  it('refuses to remove another owner\'s private preset', async () => {
    const preset = await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Theirs', filters: '{}', ownerIdentityId: 'identity-2', canManageDashboard: false, idFactory }, 'mock');
    await expect(remove(DEFAULT_ORGANIZATION_ID, preset.id, { identityId: 'identity-1', canManageDashboard: false }, 'mock')).rejects.toThrow(ReportPresetServiceError);
  });

  it('allows a caller with dashboard.manage to remove a shared preset they do not own', async () => {
    const preset = await create(DEFAULT_ORGANIZATION_ID, { reportKey: 'active-cases', name: 'Shared', filters: '{}', ownerIdentityId: 'identity-2', canManageDashboard: true, isShared: true, idFactory }, 'mock');
    await remove(DEFAULT_ORGANIZATION_ID, preset.id, { identityId: 'identity-1', canManageDashboard: true }, 'mock');
    expect(reportPresetFixtures).toHaveLength(0);
  });

  it('throws for an unknown preset id', async () => {
    await expect(remove(DEFAULT_ORGANIZATION_ID, 'bogus-id', { identityId: 'identity-1', canManageDashboard: false }, 'mock')).rejects.toThrow(ReportPresetServiceError);
  });
});
