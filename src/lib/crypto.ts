/**
 * End-to-end encryption utilities using the Web Crypto API.
 * Media (photos, videos, voice notes) is encrypted client-side before
 * being shared via P2P WebRTC data channels. The encrypted blob is
 * stored locally in IndexedDB. Nothing touches any server.
 */

const KEY_ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

async function generateKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const cryptoKey = await crypto.subtle.generateKey(
    { name: KEY_ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', cryptoKey));
  return { key: cryptoKey, raw };
}

async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: KEY_ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptData(data: ArrayBuffer | Blob): Promise<{
  encrypted: ArrayBuffer;
  iv: Uint8Array;
  keyRaw: Uint8Array;
}> {
  const { key, raw } = await generateKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const encrypted = await crypto.subtle.encrypt({ name: KEY_ALGORITHM, iv }, key, buffer);
  return { encrypted, iv, keyRaw: raw };
}

export async function decryptData(
  encrypted: ArrayBuffer,
  iv: Uint8Array,
  keyRaw: Uint8Array,
): Promise<ArrayBuffer> {
  const key = await importKey(keyRaw);
  return crypto.subtle.decrypt({ name: KEY_ALGORITHM, iv: iv as BufferSource }, key, encrypted);
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type EncryptedMediaPayload = {
  encryptedBase64: string;
  ivBase64: string;
  keyBase64: string;
  mimeType: string;
  fileName: string;
  size: number;
};

export async function encryptFile(file: File): Promise<EncryptedMediaPayload> {
  const { encrypted, iv, keyRaw } = await encryptData(file);
  return {
    encryptedBase64: arrayBufferToBase64(encrypted),
    ivBase64: arrayBufferToBase64(iv),
    keyBase64: arrayBufferToBase64(keyRaw),
    mimeType: file.type,
    fileName: file.name,
    size: file.size,
  };
}

export async function decryptPayload(payload: EncryptedMediaPayload): Promise<Blob> {
  const encrypted = base64ToArrayBuffer(payload.encryptedBase64);
  const iv = new Uint8Array(base64ToArrayBuffer(payload.ivBase64));
  const keyRaw = new Uint8Array(base64ToArrayBuffer(payload.keyBase64));
  const decrypted = await decryptData(encrypted, iv, keyRaw);
  return new Blob([decrypted], { type: payload.mimeType });
}
