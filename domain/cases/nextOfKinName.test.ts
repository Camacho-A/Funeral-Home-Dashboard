import { describe, expect, it } from 'vitest';
import { normalizeNextOfKinName } from './nextOfKinName';

describe('normalizeNextOfKinName', () => {
  it('returns a clean name (no separator) unchanged', () => {
    expect(normalizeNextOfKinName('EMMA MORALES SILVA', '(954) 901-4165')).toBe('EMMA MORALES SILVA');
  });

  it('strips a legacy combined "NAME — PHONE" suffix when it matches the stored phone exactly', () => {
    expect(normalizeNextOfKinName('EMMA MORALES SILVA — (954) 901-4165', '(954) 901-4165')).toBe(
      'EMMA MORALES SILVA',
    );
  });

  it('treats dash-formatted and unformatted phone digits as equivalent to the stored parenthesized form', () => {
    expect(normalizeNextOfKinName('EMMA MORALES SILVA — 954-901-4165', '(954) 901-4165')).toBe('EMMA MORALES SILVA');
    expect(normalizeNextOfKinName('EMMA MORALES SILVA — 9549014165', '(954) 901-4165')).toBe('EMMA MORALES SILVA');
  });

  it('leaves the name unchanged when the suffix does not correspond to nextOfKinPhone', () => {
    expect(normalizeNextOfKinName('SMITH — JONES FAMILY TRUST', '555-0100')).toBe('SMITH — JONES FAMILY TRUST');
  });

  it('never strips when nextOfKinPhone is blank or missing, even if the name contains an em dash', () => {
    expect(normalizeNextOfKinName('EMMA MORALES SILVA — (954) 901-4165', '')).toBe(
      'EMMA MORALES SILVA — (954) 901-4165',
    );
  });

  it('never invents a phone number: a name with no separator is untouched regardless of phone value', () => {
    expect(normalizeNextOfKinName('EMMA MORALES SILVA', '')).toBe('EMMA MORALES SILVA');
  });

  it('does not strip when the phone-shaped suffix has no digits at all (never blank-strips)', () => {
    expect(normalizeNextOfKinName('JANE DOE — ', '555-0100')).toBe('JANE DOE — ');
  });

  it('would not leave an empty name even in a contrived case where everything before the separator is blank', () => {
    expect(normalizeNextOfKinName(' — (954) 901-4165', '(954) 901-4165')).toBe(' — (954) 901-4165');
  });
});
