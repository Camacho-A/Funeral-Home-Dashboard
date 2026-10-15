import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertOrganizationAllowedInDeployment,
  DeploymentOrganizationError,
  filterToDeploymentOrganizations,
  isOrganizationAllowedInDeployment,
} from './deploymentOrganizations';
import { getAuthAdapterMode, getDeploymentOrganizationIds, isAuthAdapterAllowedForDataAdapter } from '../env';

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('getDeploymentOrganizationIds', () => {
  it('is unrestricted (null) when unset outside production', () => {
    process.env.DATA_ADAPTER = 'wix';
    expect(getDeploymentOrganizationIds()).toBeNull();
  });

  it('is unrestricted when unset in production with mock data', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getDeploymentOrganizationIds()).toBeNull();
  });

  it('fails closed when unset in production with Wix data', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DATA_ADAPTER = 'wix';
    expect(() => getDeploymentOrganizationIds()).toThrow(/DEPLOYMENT_ORGANIZATION_IDS is not set/);
  });

  it('parses, trims and de-duplicates a comma-separated list', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = ' gus-camacho-jr , other-home,gus-camacho-jr ';
    expect(getDeploymentOrganizationIds()).toEqual(['gus-camacho-jr', 'other-home']);
  });

  it('accepts onboarding UUID organization ids', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = '3f1c2a4e-9b7d-4c1a-8e2f-0a1b2c3d4e5f';
    expect(getDeploymentOrganizationIds()).toEqual(['3f1c2a4e-9b7d-4c1a-8e2f-0a1b2c3d4e5f']);
  });

  it('rejects malformed ids instead of silently ignoring them', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr,Managed Cremations';
    expect(() => getDeploymentOrganizationIds()).toThrow(/invalid: Managed Cremations/);
  });

  it('rejects a value with no ids at all', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = ' , ,';
    expect(() => getDeploymentOrganizationIds()).toThrow(/Invalid DEPLOYMENT_ORGANIZATION_IDS/);
  });
});

describe('deployment organization gate', () => {
  it('allows every organization when unrestricted', () => {
    expect(isOrganizationAllowedInDeployment('managed-cremations')).toBe(true);
    expect(isOrganizationAllowedInDeployment('gus-camacho-jr')).toBe(true);
  });

  it('never allows a missing organization id', () => {
    expect(isOrganizationAllowedInDeployment(undefined)).toBe(false);
    expect(isOrganizationAllowedInDeployment(null)).toBe(false);
    expect(isOrganizationAllowedInDeployment('')).toBe(false);
  });

  it('allows only listed organizations when restricted (Gus deployment never serves Manors)', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    expect(isOrganizationAllowedInDeployment('gus-camacho-jr')).toBe(true);
    expect(isOrganizationAllowedInDeployment('managed-cremations')).toBe(false);
    expect(() => assertOrganizationAllowedInDeployment('managed-cremations')).toThrow(DeploymentOrganizationError);
    expect(() => assertOrganizationAllowedInDeployment('gus-camacho-jr')).not.toThrow();
  });

  it('compares ids exactly (no prefix/case tricks)', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    expect(isOrganizationAllowedInDeployment('gus-camacho-jr-2')).toBe(false);
    expect(isOrganizationAllowedInDeployment('GUS-CAMACHO-JR')).toBe(false);
  });

  it('filters cross-tenant records out of a sweep', () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = 'gus-camacho-jr';
    const rows = [
      { id: 'a', organizationId: 'gus-camacho-jr' },
      { id: 'b', organizationId: 'managed-cremations' },
      { id: 'c', organizationId: null },
    ];
    expect(filterToDeploymentOrganizations(rows, (r) => r.organizationId).map((r) => r.id)).toEqual(['a']);
  });
});

describe('auth adapter / data adapter pairing', () => {
  it('defaults AUTH_ADAPTER to mock with mock data', () => {
    expect(getAuthAdapterMode()).toBe('mock');
  });

  it('fails closed to identity when AUTH_ADAPTER is unset with Wix data', () => {
    process.env.DATA_ADAPTER = 'wix';
    expect(getAuthAdapterMode()).toBe('identity');
  });

  it('only allows mock or Wix-Members auth with mock data', () => {
    expect(isAuthAdapterAllowedForDataAdapter('mock', 'mock')).toBe(true);
    expect(isAuthAdapterAllowedForDataAdapter('wix', 'mock')).toBe(true);
    expect(isAuthAdapterAllowedForDataAdapter('identity', 'mock')).toBe(true);
    expect(isAuthAdapterAllowedForDataAdapter('identity', 'wix')).toBe(true);
    expect(isAuthAdapterAllowedForDataAdapter('mock', 'wix')).toBe(false);
    expect(isAuthAdapterAllowedForDataAdapter('wix', 'wix')).toBe(false);
  });
});
