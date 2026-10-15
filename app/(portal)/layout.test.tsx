import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * Portal layout (2026-10): identity login over MOCK data, end-to-end, and
 * stale-session handling without cookie mutation during render.
 *
 * `next/headers` is replaced by an in-memory cookie jar that behaves like
 * Next.js: cookies can be set/deleted from a Server Action, but throw when
 * modified during a Server Component render (`phase === 'render'`). Every
 * other module — loginAction, sessionService, the fixtures, the layout —
 * is real. Between login and render the module registry is reset, which is
 * exactly what `next dev` does to us (separate module instances for the
 * Server Action and the RSC render): the mock store must still find the
 * session the login created.
 */

const jar = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  phase: 'action' as 'action' | 'render',
  mutationsDuringRender: 0,
  redirects: [] as string[],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (jar.phase === 'render') {
        jar.mutationsDuringRender += 1;
        throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      }
      jar.cookies.set(name, value);
    },
    delete: (name: string) => {
      if (jar.phase === 'render') {
        jar.mutationsDuringRender += 1;
        throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      }
      jar.cookies.delete(name);
    },
  }),
  headers: async () => ({ get: (name: string) => (name === 'user-agent' ? 'vitest-agent' : null) }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    jar.redirects.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

// Presentational shells only — the layout's job under test is session and
// organization resolution, not rendering the app chrome.
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: { children: unknown }) => children }));
vi.mock('@/hooks/useCaseSearch', () => ({ CaseSearchProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/hooks/useOrganization', () => ({ OrganizationProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/hooks/useSession', () => ({ SessionProvider: ({ children }: { children: unknown }) => children }));

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.DATA_ADAPTER = 'mock';
  process.env.AUTH_ADAPTER = 'identity';
  jar.cookies.clear();
  jar.phase = 'action';
  jar.mutationsDuringRender = 0;
  jar.redirects.length = 0;
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

async function signInAs(email: string, password: string): Promise<void> {
  const { loginAction } = await import('@/app/login/actions');
  const form = new FormData();
  form.set('email', email);
  form.set('password', password);
  form.set('next', '/dashboard');
  jar.phase = 'action';
  await expect(loginAction(form)).rejects.toThrow('REDIRECT:/dashboard');
}

/** Renders the layout in a FRESH module registry, as `next dev` does. */
async function renderLayoutFresh(): Promise<{ element: ReactElement | null; redirect: string | null }> {
  vi.resetModules();
  const { default: PortalLayout } = await import('./layout');
  jar.phase = 'render';
  try {
    const element = (await PortalLayout({ children: 'page' })) as ReactElement;
    return { element, redirect: null };
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('REDIRECT:')) return { element: null, redirect: message.slice('REDIRECT:'.length) };
    throw error;
  } finally {
    jar.phase = 'action';
  }
}

function organizationIdOf(element: ReactElement): string {
  // <ScopedQueryClientProvider><CaseSearchProvider><OrganizationProvider organizationId=...>
  const caseSearchProvider = (element.props as { children: ReactElement }).children;
  const organizationProvider = (caseSearchProvider.props as { children: ReactElement }).children;
  return (organizationProvider.props as { organizationId: string }).organizationId;
}

function queryCacheScopeOf(element: ReactElement): string | null {
  return element.key;
}

describe('PortalLayout — identity login over mock data', () => {
  it('a session created by the login Server Action is found by the layout in a separate module instance', async () => {
    const { GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD, GUS_ORGANIZATION_ID } = await import('@/services/__mocks__/gusFixtures');
    await signInAs(GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD);
    expect(jar.cookies.size).toBe(1);

    const result = await renderLayoutFresh();

    expect(result.redirect).toBeNull();
    expect(organizationIdOf(result.element!)).toBe(GUS_ORGANIZATION_ID);
    // The client query cache belongs to this identity in this organization only.
    expect(queryCacheScopeOf(result.element!)).toMatch(new RegExp(`^staff:[^:]+:${GUS_ORGANIZATION_ID}$`));
    expect(jar.mutationsDuringRender).toBe(0);
  });

  it('keeps working on repeated renders (valid sessions unaffected)', async () => {
    const { GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD } = await import('@/services/__mocks__/gusFixtures');
    await signInAs(GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD);

    expect((await renderLayoutFresh()).redirect).toBeNull();
    expect((await renderLayoutFresh()).redirect).toBeNull();
    expect(jar.cookies.size).toBe(1);
  });
});

describe('PortalLayout — stale or disallowed sessions never mutate cookies during render', () => {
  it('a revoked identity session redirects to the clear-session Route Handler, leaving the cookie for it to delete', async () => {
    const { GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD } = await import('@/services/__mocks__/gusFixtures');
    await signInAs(GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD);

    const { getSession } = await import('@/lib/auth/session');
    const { revokeSession } = await import('@/services/sessionService');
    const session = await getSession();
    await revokeSession(session!.sessionId!, 'mock');

    const result = await renderLayoutFresh();

    expect(result.redirect).toBe('/api/auth/clear-session?reason=revoked');
    expect(jar.mutationsDuringRender).toBe(0);
    expect(jar.cookies.size).toBe(1);
  });

  it('an identity cookie whose registry row does not exist redirects with session_not_found', async () => {
    const { createSessionToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken');
    const token = await createSessionToken(
      { id: 'identity-gus-admin', email: 'admin@gus-camacho-jr.test', displayName: 'Avery Demo', source: 'identity' },
      undefined,
      'no-such-session',
    );
    jar.cookies.set(SESSION_COOKIE_NAME, token);

    const result = await renderLayoutFresh();

    expect(result.redirect).toBe('/api/auth/clear-session?reason=session_not_found');
    expect(jar.mutationsDuringRender).toBe(0);
  });

  it('a mock-login session is refused (fail closed) when DATA_ADAPTER=wix', async () => {
    const { createSessionToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken');
    const { mockDefaultUser } = await import('@/services/__mocks__/authFixtures');
    jar.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(mockDefaultUser));
    process.env.DATA_ADAPTER = 'wix';

    const result = await renderLayoutFresh();

    expect(result.redirect).toBe('/api/auth/clear-session?reason=auth_adapter_not_allowed');
    expect(jar.mutationsDuringRender).toBe(0);
  });

  it('a mock-login session is still accepted with mock data (local development unchanged)', async () => {
    const { createSessionToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/sessionToken');
    const { mockDefaultUser } = await import('@/services/__mocks__/authFixtures');
    jar.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(mockDefaultUser));
    process.env.AUTH_ADAPTER = 'mock';

    const result = await renderLayoutFresh();

    expect(result.redirect).toBeNull();
    expect(organizationIdOf(result.element!)).toBe('managed-cremations');
  });
});
