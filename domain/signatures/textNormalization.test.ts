import { describe, expect, it } from 'vitest';
import { normalizeSignatureRequestTextFields } from './textNormalization';

describe('normalizeSignatureRequestTextFields', () => {
  it('uppercases signerName', () => {
    expect(normalizeSignatureRequestTextFields({ signerName: 'jane smith' })).toEqual({ signerName: 'JANE SMITH' });
  });

  it('leaves other fields on the same object untouched', () => {
    const result = normalizeSignatureRequestTextFields({ signerName: 'jane smith', signerEmail: 'Jane.Smith@example.com', signerRole: 'next_of_kin' });
    expect(result.signerEmail).toBe('Jane.Smith@example.com');
    expect(result.signerRole).toBe('next_of_kin');
  });

  it('is idempotent', () => {
    expect(normalizeSignatureRequestTextFields({ signerName: 'JANE SMITH' })).toEqual({ signerName: 'JANE SMITH' });
  });
});
