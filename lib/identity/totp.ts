import { createHmac, randomBytes } from 'crypto';

/**
 * Phase 21 (Identity, Authentication & Session Management). RFC
 * 6238 (TOTP) / RFC 4226 (HOTP) — hand-rolled rather than a new
 * dependency, since the algorithm is small, fixed, and doesn't change:
 * HMAC-SHA1 over a 30-second time counter, base32-encoded secret (the
 * standard authenticator-app format — Google Authenticator, Authy,
 * 1Password, etc. all expect base32).
 *
 * "MFA may remain optional in v1" — this module is the real, working
 * algorithm regardless; nothing about it is a stub.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1; // tolerate ±1 step (±30s) of clock drift

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit (20-byte) secret — the RFC-recommended length,
    base32-encoded for direct use in an authenticator app / QR code. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secretBase32: string, counter: number, digits: number): string {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binaryCode % 10 ** digits).toString().padStart(digits, '0');
}

export function generateTotpCode(
  secretBase32: string,
  time: number = Date.now(),
  stepSeconds: number = DEFAULT_STEP_SECONDS,
  digits: number = DEFAULT_DIGITS,
): string {
  const counter = Math.floor(time / 1000 / stepSeconds);
  return hotp(secretBase32, counter, digits);
}

/** Accepts a code from the current step or ±`window` steps away, so a
    slightly-drifted device clock (or the delay between generating and
    submitting a code) doesn't spuriously fail. */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  time: number = Date.now(),
  stepSeconds: number = DEFAULT_STEP_SECONDS,
  window: number = DEFAULT_WINDOW,
): boolean {
  const counter = Math.floor(time / 1000 / stepSeconds);
  for (let drift = -window; drift <= window; drift += 1) {
    if (hotp(secretBase32, counter + drift, code.length || DEFAULT_DIGITS) === code) return true;
  }
  return false;
}
