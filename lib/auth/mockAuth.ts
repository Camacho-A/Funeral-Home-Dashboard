import type { AuthenticatedUser } from '../../types/auth';
import { MOCK_LOGIN_EMAIL, MOCK_LOGIN_PASSWORD, mockDefaultUser } from '../../services/__mocks__/authFixtures';

export type MockLoginResult = { success: true; user: AuthenticatedUser } | { success: false };

/**
 * Validates mock login credentials. Deliberately returns the same generic
 * failure regardless of whether the email doesn't match or the password
 * doesn't match — "do not reveal whether a private account exists through
 * overly specific error messages" applies just as much to a one-account
 * mock system as it will to a real one, so the mock path exercises the
 * same discipline the real path needs.
 */
export function verifyMockCredentials(email: string, password: string): MockLoginResult {
  const emailMatches = email.trim().toLowerCase() === MOCK_LOGIN_EMAIL.toLowerCase();
  const passwordMatches = password === MOCK_LOGIN_PASSWORD;

  if (emailMatches && passwordMatches) {
    return { success: true, user: mockDefaultUser };
  }
  return { success: false };
}
