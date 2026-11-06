import { base64UrlEncode } from './base64Url.ts';
import { strHmacSha1 } from './strHmacSha1.ts';

const CIPHERTEXT_SIZE = 8;
const SIGNATURE_SIZE = 4;

export const createCrypter = (encryptionKey: string, signatureKey: string) => {
  const encryptionKeyDecoded = atob(encryptionKey);
  const signatureKeyDecoded = atob(signatureKey);
  return (nonce: string, plaintext: string): string => {
    if (plaintext.length > CIPHERTEXT_SIZE) throw new Error('data to encrypt is too long');

    // create initialization vector (IV) from nonce, padded to 16 bytes
    const initVector = nonce.padEnd(16, '0').substring(0, 16);

    // create keystream from IV and encryption key
    const keystream = strHmacSha1(encryptionKeyDecoded, initVector);

    // encrypt plaintext with keystream into ciphertext
    let cipherText = '';
    for (let i = 0; i < CIPHERTEXT_SIZE; i++) {
      const plaintextByte = (i >= plaintext.length) ? 0 : plaintext.charCodeAt(i);
      cipherText += String.fromCharCode(0xff & (plaintextByte ^ keystream.charCodeAt(i)));
    }

    // create signature for integrity check
    const integrityData = plaintext.padEnd(CIPHERTEXT_SIZE, '\u0000') + initVector;
    const signature = strHmacSha1(signatureKeyDecoded, integrityData).substring(0, SIGNATURE_SIZE);

    return base64UrlEncode(initVector + cipherText + signature);
  };
};
