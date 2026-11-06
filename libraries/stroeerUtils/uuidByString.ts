import { sha1Uint8Array } from './sha1.ts';

/**
 * Converts unsigned byte to hex representation
 * @param byte The unsigned byte to convert
 * @returns The hex representation
 */
const uint8ToHex = (byte: number): string => byte.toString(16).padStart(2, '0');

/**
 * Converts unsigned byte buffer to hex string
 *
 * @param buf The unsigned bytes buffer
 * @returns The hex string representation
 */
const uint8ArrayToHex = (buf: Uint8Array<ArrayBufferLike>): string => buf.reduce((out, byte) => out + uint8ToHex(byte), '');

/**
 * Generates the Name-Based UUID hashes v5 according to RFC-4122.
 *
 * @see https://tools.ietf.org/html/rfc4122#section-4.3
 *
 * @param input Hashing input
 * @returns UUID
 */
export const getUuidByString = (input: string): string => {
  // converts input string to buffer of char codes
  const charBuffer: Uint8Array<ArrayBufferLike> = new TextEncoder().encode(input);
  // generates SHA-1 hash from buffer
  const hashBuffer: Uint8Array<ArrayBufferLike> = sha1Uint8Array(charBuffer);
  // creates uuid from hash buffer
  const DASH = '-';
  return [
    uint8ArrayToHex(hashBuffer.slice(0, 4)),
    DASH,
    uint8ArrayToHex(hashBuffer.slice(4, 6)),
    DASH,
    uint8ToHex((hashBuffer[6] & 0x0f) | 0x50),
    uint8ToHex(hashBuffer[7]),
    DASH,
    uint8ToHex((hashBuffer[8] & 0x3f) | 0x80),
    uint8ToHex(hashBuffer[9]),
    DASH,
    uint8ArrayToHex(hashBuffer.slice(10, 16)),
  ].join('');
}
