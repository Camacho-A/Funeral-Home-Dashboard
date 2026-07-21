import { describe, expect, it } from 'vitest';
import { verifyMockCredentials } from './mockAuth';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD, mockDefaultUser } from '../../services/__mocks__/authFixtures';

describe('verifyMockCredentials', () => {
  it('succeeds with the correct mock email and password', () => {
    const result = verifyMockCredentials(MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD);
    expect(result).toEqual({ success: true, user: mockDefaultUser });
  });

  it('is case-insensitive and trims whitespace on the email', () => {
    const result = verifyMockCredentials(`  ${MOCK_LOGIN_EMAIL.toUpperCase()}  `, MOCK_LOGIN_PASSWORD);
    expect(result.success).toBe(true);
  });

  it('fails generically on a wrong password, without revealing the email was correct', () => {
    const result = verifyMockCredentials(MOCK_LOGIN_EMAIL, 'wrong-password');
    expect(result).toEqual({ success: false });
  });

  it('fails generically on an unknown email, with the exact same shape as a wrong password', () => {
    const result = verifyMockCredentials('nobody@example.com', MOCK_LOGIN_PASSWORD);
    expect(result).toEqual({ success: false });
  });

  it('the two failure cases are indistinguishable to the caller', () => {
    const wrongPassword = verifyMockCredentials(MOCK_LOGIN_EMAIL, 'wrong');
    const wrongEmail = verifyMockCredentials('nobody@example.com', MOCK_LOGIN_PASSWORD);
    expect(wrongPassword).toEqual(wrongEmail);
  });
});
