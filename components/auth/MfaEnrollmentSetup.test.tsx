import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const client = vi.hoisted(() => ({ beginMfa: vi.fn(), verifyMfa: vi.fn() }));
vi.mock('@/lib/mfaClient', () => client);

const { MfaEnrollmentSetup } = await import('./MfaEnrollmentSetup');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MfaEnrollmentSetup (required enrollment, fictional data)', () => {
  it('sets up, verifies, shows the recovery codes once, then continues to where staff were going', async () => {
    client.beginMfa.mockResolvedValue({ secret: 'FICTIONALSECRET', otpauthUri: 'otpauth://totp/SOLIS:fictional' });
    client.verifyMfa.mockResolvedValue(['aaaa-1111', 'bbbb-2222']);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<MfaEnrollmentSetup next="/cases" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    expect(await screen.findByText('FICTIONALSECRET')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Enter the 6-digit code from your app'), { target: { value: ' 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & turn on' }));
    expect(await screen.findByText('aaaa-1111')).toBeTruthy();
    expect(client.verifyMfa).toHaveBeenCalledWith('123456');

    fireEvent.click(screen.getByRole('button', { name: /I saved my recovery codes/ }));
    expect(assign).toHaveBeenCalledWith('/cases');
    vi.unstubAllGlobals();
  });

  it('a wrong code keeps staff on the step with the reason; "Start over" issues a new key', async () => {
    client.beginMfa.mockResolvedValueOnce({ secret: 'FIRSTKEY', otpauthUri: 'otpauth://first' }).mockResolvedValueOnce({ secret: 'SECONDKEY', otpauthUri: 'otpauth://second' });
    client.verifyMfa.mockRejectedValue(new Error('That code was not correct.'));
    render(<MfaEnrollmentSetup next="/" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await screen.findByText('FIRSTKEY');
    fireEvent.change(screen.getByLabelText('Enter the 6-digit code from your app'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & turn on' }));
    expect(await screen.findByText('That code was not correct.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start over with a new key' }));
    expect(await screen.findByText('SECONDKEY')).toBeTruthy();
    expect(client.beginMfa).toHaveBeenCalledTimes(2);
  });
});
