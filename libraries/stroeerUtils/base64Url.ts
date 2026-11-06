/**
 * Encodes a string to base64url format, which is a URL-safe variant of base64 encoding.
 * It replaces '+' with '-', '/' with '_', and removes any trailing '=' padding.
 *
 * @param s The input string to be encoded.
 * @returns The base64url-encoded string.
 */
export const base64UrlEncode = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Decodes a base64url-encoded string back to its original form.
 * Base64url is a URL-safe variant of base64 encoding that
 * replaces '+' with '-', '/' with '_', and omits padding characters ('=').
 *
 * @param s The base64url-encoded string to decode.
 * @returns The original decoded string.
 */
export const base64UrlDecode = (s: string): string => atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/'));
