/**
 * simplified one-round SHA-1 of Uint8Array — RFC 3174 - derived from js-sha1
 *
 * @see https://github.com/emn178/js-sha1/tree/v0.6.0
 */
export const sha1Uint8Array = (input: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> => {
  const len = input.length;
  const totalLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(totalLen);
  buf.set(input);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, Math.floor(len / 0x1fffffff) | 0);
  dv.setUint32(totalLen - 4, (len * 8) >>> 0);

  let h0 = 0x67452301; let h1 = 0xEFCDAB89; let h2 = 0x98BADCFE; let h3 = 0x10325476; let h4 = 0xC3D2E1F0;
  const w = new Int32Array(80);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const t = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (t << 1) | (t >>> 31);
    }

    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4;

    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5A827999]
          : i < 40 ? [b ^ c ^ d, 0x6ED9EBA1]
            : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8F1BBCDC]
              : [b ^ c ^ d, 0xCA62C1D6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }

    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
  }

  const out = new DataView(new ArrayBuffer(20));
  out.setUint32(0, h0);
  out.setUint32(4, h1);
  out.setUint32(8, h2);
  out.setUint32(12, h3);
  out.setUint32(16, h4);
  return new Uint8Array(out.buffer);
};
