import { describe, it, expect } from 'vitest';
import { parseLoginOrganizationHosts, resolveLoginOrganizationId } from './loginBranding';

const MANORS_HOSTS = parseLoginOrganizationHosts(
  'solis.manorscremation.com=managed-cremations,beacon.manorscremation.com=managed-cremations',
);

describe('parseLoginOrganizationHosts', () => {
  it('maps each configured hostname to its organization', () => {
    expect(MANORS_HOSTS.get('solis.manorscremation.com')).toBe('managed-cremations');
    expect(MANORS_HOSTS.get('beacon.manorscremation.com')).toBe('managed-cremations');
  });

  it('accepts newline-separated entries and surrounding whitespace', () => {
    const map = parseLoginOrganizationHosts('\n  a.example.com = org-a \n b.example.com=org-b\n');
    expect(map.get('a.example.com')).toBe('org-a');
    expect(map.get('b.example.com')).toBe('org-b');
  });

  it('lowercases hostnames, which are case-insensitive', () => {
    expect(parseLoginOrganizationHosts('SOLIS.ManorsCremation.com=managed-cremations').get('solis.manorscremation.com')).toBe(
      'managed-cremations',
    );
  });

  it('skips malformed entries instead of throwing', () => {
    // One typo must cost that hostname its logo, never break sign-in for
    // every organization on the deployment.
    const map = parseLoginOrganizationHosts('garbage,=orphan,host-with-no-org=,good.example.com=org-good');
    expect(map.size).toBe(1);
    expect(map.get('good.example.com')).toBe('org-good');
  });

  it('is empty for unset or blank configuration', () => {
    expect(parseLoginOrganizationHosts(null).size).toBe(0);
    expect(parseLoginOrganizationHosts(undefined).size).toBe(0);
    expect(parseLoginOrganizationHosts('   ').size).toBe(0);
  });
});

describe('resolveLoginOrganizationId', () => {
  it('brands the login screen from the request hostname', () => {
    expect(
      resolveLoginOrganizationId({
        host: 'solis.manorscremation.com',
        hostOrganizationIds: MANORS_HOSTS,
        configuredOrganizationId: null,
      }),
    ).toBe('managed-cremations');
  });

  it('matches a hostname regardless of case, port, or trailing dot', () => {
    for (const host of ['SOLIS.manorscremation.com', 'solis.manorscremation.com:443', 'solis.manorscremation.com.']) {
      expect(
        resolveLoginOrganizationId({ host, hostOrganizationIds: MANORS_HOSTS, configuredOrganizationId: null }),
      ).toBe('managed-cremations');
    }
  });

  it('gives each organization its own branding on one deployment', () => {
    const hosts = parseLoginOrganizationHosts(
      'solis.manorscremation.com=managed-cremations,gus.example.com=gus-camacho-jr',
    );
    expect(resolveLoginOrganizationId({ host: 'gus.example.com', hostOrganizationIds: hosts, configuredOrganizationId: null })).toBe(
      'gus-camacho-jr',
    );
    expect(
      resolveLoginOrganizationId({ host: 'solis.manorscremation.com', hostOrganizationIds: hosts, configuredOrganizationId: null }),
    ).toBe('managed-cremations');
  });

  it('shows generic SOLIS branding on an unmapped hostname', () => {
    // A forged or unrecognised Host must never reach into a tenant's
    // branding — this is the whole reason the map is explicit.
    expect(
      resolveLoginOrganizationId({
        host: 'attacker.example.net',
        hostOrganizationIds: MANORS_HOSTS,
        configuredOrganizationId: null,
      }),
    ).toBeNull();
  });

  it('shows generic SOLIS branding when nothing is configured at all', () => {
    // Explicitly NOT "use the only organization in the database" — a
    // generic SOLIS login must not default into somebody's tenant.
    expect(
      resolveLoginOrganizationId({
        host: 'app.solis.example',
        hostOrganizationIds: new Map(),
        configuredOrganizationId: null,
      }),
    ).toBeNull();
  });

  it('falls back to the single-tenant configuration on an unmapped host', () => {
    expect(
      resolveLoginOrganizationId({
        host: 'anything.example',
        hostOrganizationIds: new Map(),
        configuredOrganizationId: 'managed-cremations',
      }),
    ).toBe('managed-cremations');
  });

  it('prefers the host map over the single-tenant configuration', () => {
    // A deployment that grew from one organization to several must brand
    // each domain correctly, not keep showing the original tenant.
    expect(
      resolveLoginOrganizationId({
        host: 'gus.example.com',
        hostOrganizationIds: parseLoginOrganizationHosts('gus.example.com=gus-camacho-jr'),
        configuredOrganizationId: 'managed-cremations',
      }),
    ).toBe('gus-camacho-jr');
  });

  it('treats a missing host and a blank configured id as unset', () => {
    expect(
      resolveLoginOrganizationId({ host: null, hostOrganizationIds: MANORS_HOSTS, configuredOrganizationId: '  ' }),
    ).toBeNull();
    expect(
      resolveLoginOrganizationId({ host: undefined, hostOrganizationIds: MANORS_HOSTS, configuredOrganizationId: undefined }),
    ).toBeNull();
  });

  it('trims a configured id so a stray newline does not break the lookup', () => {
    expect(
      resolveLoginOrganizationId({ host: null, hostOrganizationIds: new Map(), configuredOrganizationId: ' managed-cremations\n' }),
    ).toBe('managed-cremations');
  });
});
