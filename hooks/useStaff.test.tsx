import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let mode: 'mock' | 'wix' = 'wix';
vi.mock('./useOrganization', () => ({ useOrganization: () => ({ organizationId: 'managed-cremations', dataAdapterMode: mode }) }));
const list = vi.fn(async () => [{ id: 'staff-fixture', displayName: 'Fixture' }]);
vi.mock('@/services/staffProfileService', () => ({ list: (...args: unknown[]) => list(...(args as [])) }));

const { useStaff } = await import('./useStaff');

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  list.mockClear();
});

describe('useStaff (2026-10)', () => {
  it('real data comes from the server route — never the Wix service in the browser', async () => {
    mode = 'wix';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ staff: [{ id: 'staff-dana', displayName: 'Dana' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/profiles?organizationId=managed-cremations');
    expect(result.current.data).toEqual([{ id: 'staff-dana', displayName: 'Dana' }]);
    expect(list).not.toHaveBeenCalled();
  });

  it('a failed load is an error, not an empty staff list', async () => {
    mode = 'wix';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 502 })));
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('mock mode reads the fixtures as before', async () => {
    mode = 'mock';
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith('managed-cremations', 'mock');
  });
});
