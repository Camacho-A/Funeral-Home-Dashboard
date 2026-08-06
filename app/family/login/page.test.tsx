import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FamilyLoginPage from './page';
import * as familyClient from '@/lib/familyClient';

const pushMock = vi.fn();
const refreshMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/familyClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/familyClient')>('@/lib/familyClient');
  return { ...actual, familyLogin: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe('FamilyLoginPage', () => {
  it('renders the sign-in form', () => {
    render(<FamilyLoginPage />);
    expect(screen.getByRole('heading', { name: 'Family Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('submits credentials and redirects to /family/dashboard on success', async () => {
    vi.mocked(familyClient.familyLogin).mockResolvedValue(undefined);
    render(<FamilyLoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'family@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(familyClient.familyLogin).toHaveBeenCalledWith({ email: 'family@example.com', password: 'Password123!' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/family/dashboard'));
  });

  it('redirects to a same-origin ?next= path instead of the default dashboard', async () => {
    searchParams = new URLSearchParams({ next: '/family/cases/case-1' });
    vi.mocked(familyClient.familyLogin).mockResolvedValue(undefined);
    render(<FamilyLoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'family@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/family/cases/case-1'));
  });

  it('shows the generic error message on a failed login, never distinguishing the reason', async () => {
    vi.mocked(familyClient.familyLogin).mockRejectedValue(new Error('Invalid email or password.'));
    render(<FamilyLoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'family@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
