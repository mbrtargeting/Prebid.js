/* eslint-disable camelcase */
// Code taken from http://pajhome.org.uk/crypt/md5/sha1.js

/** Bits per input character: 8 for ASCII/Latin-1 (used here), 16 for Unicode. */
const chrsz = 8;

/**
 * SHA-1 core transform. Mutates and consumes `x` as big-endian 32-bit words, appends
 * SHA-1 padding in place, and returns the digest as five 32-bit words `[a, b, c, d, e]`.
 *
 * @param x - message as big-endian 32-bit words (as produced by {@link str2binb})
 * @param len - message length in bits, before padding
 */
const core_sha1 = (x: number[], len: number): number[] => {
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  let w = Array(80);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  let e = -1009589776;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;
    const olde = e;

    for (let j = 0; j < 80; j++) {
      if (j < 16) {
        w[j] = x[i + j];
      } else {
        w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }
      const t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)), safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return [a, b, c, d, e];
};

/** SHA-1 round function: selects the bitwise combination of `b`, `c`, `d` for round `t` (0-79). */
const sha1_ft = (t: number, b: number, c: number, d: number): number => {
  if (t < 20) {
    return (b & c) | ((~b) & d);
  }
  if (t < 40) {
    return b ^ c ^ d;
  }
  if (t < 60) {
    return (b & c) | (b & d) | (c & d);
  }
  return b ^ c ^ d;
};

/** SHA-1 round constant for round `t` (0-79), per the SHA-1 spec. */
const sha1_kt = (t: number): number => {
  return (t < 20) ? 1518500249 : (t < 40) ? 1859775393 : (t < 60) ? -1894007588 : -899497514;
};

/**
 * Computes the raw HMAC-SHA1 digest as big-endian 32-bit words (RFC 2104), keyed with `key`
 * over `data`. Both `key` and `data` are treated as 8-bit strings. If `key` is longer than
 * the SHA-1 block size (64 bytes / 16 words) it is first hashed down to 20 bytes, per HMAC.
 */
const core_hmac_sha1 = (key: string, data: string): number[] => {
  let bkey = str2binb(key);
  if (bkey.length > 16) {
    bkey = core_sha1(bkey, key.length * chrsz);
  }

  const ipad = Array(16);
  const opad = Array(16);
  for (let i = 0; i < 16; i++) {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  const hash = core_sha1(ipad.concat(str2binb(data)), 512 + data.length * chrsz);
  return core_sha1(opad.concat(hash), 512 + 160);
};

/**
 * Adds two 32-bit integers, wrapping at 2^32. Uses 16-bit intermediate operations to work
 * around bugs in some (historical) JS interpreters — see file header for the original source.
 */
const safe_add = (x: number, y: number): number => {
  const lsw = (x & 0xFFFF) + (y & 0xFFFF);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
};

/** Rotates a 32-bit number `num` left by `cnt` bits. */
const rol = (num: number, cnt: number): number => {
  return (num << cnt) | (num >>> (32 - cnt));
};

/**
 * Converts an 8-bit string to an array of big-endian 32-bit words (one bit-packed word per
 * 4 characters). Characters with a code point above 255 have their high byte silently
 * discarded, since {@link chrsz} is fixed at 8 here.
 */
const str2binb = (str: string): number[] => {
  const bin: number[] = [];
  const mask = (1 << chrsz) - 1;
  for (let i = 0; i < str.length * chrsz; i += chrsz) {
    bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << (32 - chrsz - i % 32);
  }
  return bin;
};

/** Converts an array of big-endian 32-bit words back to an 8-bit string, the inverse of {@link str2binb}. */
const binb2str = (bin: number[]): string => {
  let str: string = '';
  const mask: number = (1 << chrsz) - 1;
  for (let i = 0; i < bin.length * 32; i += chrsz) {
    str += String.fromCharCode((bin[i >> 5] >>> (32 - chrsz - i % 32)) & mask);
  }
  return str;
};

/**
 * Computes the HMAC-SHA1 of a key and some data, operating on 8-bit (ASCII/Latin-1) string
 * characters rather than byte arrays.
 *
 * Characters with a code point above 255 have their high byte silently discarded — this is a
 * legacy behavior of the underlying implementation (see file header), not a validation.
 *
 * @see https://en.wikipedia.org/wiki/HMAC#HMAC-SHA1
 *
 * @param key - secret key, as an 8-bit string (e.g. base64-decoded via `atob`)
 * @param data - message to authenticate, as an 8-bit string
 * @returns the 20-byte HMAC-SHA1 digest, encoded as a 20-character 8-bit string
 */
export const strHmacSha1 = (key: string, data: string): string => binb2str(core_hmac_sha1(key, data));
