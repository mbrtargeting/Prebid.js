import { base64UrlDecode } from './base64Url.ts';
import { strHmacSha1 } from './strHmacSha1.ts';

const CIPHERTEXT_SIZE = 8;
const SIGNATURE_SIZE = 4;

export const createDecrypter = (encryptionKey: string, signatureKey: string) => {
    const encryptionKeyDecoded = atob(encryptionKey);
    const signatureKeyDecoded = atob(signatureKey);
    return (str: string) => {
        const strDecoded = base64UrlDecode(str);

        // extract initVector, cipherText, and signature from the decoded string
        const initVector = strDecoded.substring(0, 16);
        const cipherText = strDecoded.substring(16, 16 + CIPHERTEXT_SIZE);
        const signature = strDecoded.substring(16 + CIPHERTEXT_SIZE, 16 + CIPHERTEXT_SIZE + SIGNATURE_SIZE);

        // create keystream from IV and encryption key
        const keystream = strHmacSha1(encryptionKeyDecoded, initVector);

        // decrypt ciphertext with keystream into plaintext
        let plaintext = '';
        for (let i = 0; i < CIPHERTEXT_SIZE; i++) {
            const cipherByte = cipherText.charCodeAt(i);
            const plaintextByte = 0xff & (cipherByte ^ keystream.charCodeAt(i));
            if (plaintextByte === 0) break;
            plaintext += String.fromCharCode(plaintextByte);
        }

        // verify signature for integrity check
        const integrityData = plaintext.padEnd(CIPHERTEXT_SIZE, '\u0000') + initVector;
        const expectedSignature = strHmacSha1(signatureKeyDecoded, integrityData).substring(0, SIGNATURE_SIZE);
        if (signature !== expectedSignature) throw new Error('signature mismatch');

        return plaintext;
    }
}
