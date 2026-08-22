// Crypto utilities for VaultDrop
// Zero-knowledge encryption: AES-256-GCM with PBKDF2 key derivation
// All encryption/decryption happens client-side; server never sees plaintext

// =====================================================
// Constants
// =====================================================
const ITERATIONS = 600_000;     // PBKDF2 iterations (NIST SP 800-63B recommends >= 600K for PBKDF2-SHA256)
const KEY_LENGTH = 256;         // AES-256
const SALT_LENGTH = 16;         // 128-bit salt
const NONCE_LENGTH = 12;        // 96-bit nonce (recommended for AES-GCM)
const PIN_LENGTH = 6;           // 6-digit numeric PIN
const MAX_PIN_ATTEMPTS = 5;     // Max failed PIN attempts before locking
const PBKDF2_ALGORITHM = "SHA-256";

// =====================================================
// PIN transport hashing
// =====================================================

// SHA-256 of the PIN, hex-encoded. Sent to the server INSTEAD OF the raw PIN
// on create/access so the server (which stores salt + iterations) can never
// derive the PBKDF2 key itself. Decryption still uses the raw PIN locally.
export async function hashPinForTransport(pin: string): Promise<string> {
  const subtle = getSubtle();
  const digest = await subtle.digest("SHA-256", toArrayBuffer(stringToArrayBuffer(pin)));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// True if the value looks like a SHA-256 hex digest (transport-hashed PIN)
export function isHashedPin(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// =====================================================
// Random generation
// =====================================================

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error("No secure random source available");
  }
  return bytes;
}

export function generatePIN(): string {
  const digits = "0123456789";
  let pin = "";
  const bytes = getRandomBytes(PIN_LENGTH);
  // Rejection sampling: 256 % 10 = 6, so raw modulo biases digits 0-5.
  // Keep drawing until the byte falls in the largest multiple-of-10 range.
  for (let i = 0; i < PIN_LENGTH; i++) {
    let b = bytes[i];
    while (b >= 250) b = getRandomBytes(1)[0];
    pin += digits[b % 10];
  }
  return pin;
}

export function generateSalt(): Uint8Array {
  return getRandomBytes(SALT_LENGTH);
}

export function generateNonce(): Uint8Array {
  return getRandomBytes(NONCE_LENGTH);
}

// Generate a short, random delivery ID (22 chars, URL-safe)
export function generateDeliveryId(): string {
  const bytes = getRandomBytes(16); // 128 bits
  return base64UrlEncode(bytes);
}

// =====================================================
// Base64 utilities
// =====================================================

export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function base64UrlDecode(str: string): Uint8Array {
  // Add padding back
  const pad = str.length % 4;
  if (pad === 2) str += "==";
  else if (pad === 3) str += "=";
  else if (pad === 1) throw new Error("Invalid base64url string");

  const binary = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64Encode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

export function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =====================================================
// String <-> ArrayBuffer conversion
// =====================================================

function stringToArrayBuffer(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

function arrayBufferToString(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const decoder = new TextDecoder();
  return decoder.decode(arr);
}

// Copy a Uint8Array into a standalone ArrayBuffer (safe for Web Crypto BufferSource)
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

// =====================================================
// Web Crypto API wrappers
// =====================================================

// Lazily import crypto.subtle, which may be on window or globalThis
function getSubtle(): SubtleCrypto {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  // Node.js 18+ has global crypto.subtle
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("Web Crypto API is not available in this environment");
}

// Derive an AES-GCM key from PIN + salt using PBKDF2
async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const pinBytes = stringToArrayBuffer(pin);
  const importedKey = await subtle.importKey(
    "raw",
    toArrayBuffer(pinBytes),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: iterations,
      hash: PBKDF2_ALGORITHM,
    },
    importedKey,
    {
      name: "AES-GCM",
      length: KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt a plaintext string using AES-256-GCM with PBKDF2-derived key
export async function encryptSecret(
  plaintext: string,
  pin: string,
  customIterations?: number,
): Promise<{
  encryptedData: string;
  nonce: string;
  salt: string;
  iterations: number;
}> {
  const subtle = getSubtle();
  const salt = generateSalt();
  const nonce = generateNonce();
  const iterations = customIterations || ITERATIONS;
  const key = await deriveKey(pin, salt, iterations);
  const data = stringToArrayBuffer(plaintext);

  const ciphertext = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      tagLength: 128,
    },
    key,
    toArrayBuffer(data),
  );

  return {
    encryptedData: base64Encode(new Uint8Array(ciphertext)),
    nonce: base64Encode(nonce),
    salt: base64Encode(salt),
    iterations,
  };
}

// Decrypt an AES-256-GCM encrypted message
export async function decryptSecret(
  encryptedDataB64: string,
  nonceB64: string,
  saltB64: string,
  iterations: number,
  pin: string,
): Promise<string> {
  const subtle = getSubtle();
  const salt = base64Decode(saltB64);
  const nonce = base64Decode(nonceB64);
  const ciphertext = base64Decode(encryptedDataB64);
  const key = await deriveKey(pin, salt, iterations);

  const plaintext = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      tagLength: 128,
    },
    key,
    toArrayBuffer(ciphertext),
  );

  return arrayBufferToString(plaintext);
}

// =====================================================
// File encryption (envelope scheme)
// =====================================================
// A random 256-bit content key (DEK) encrypts the file once with AES-256-GCM
// and a fresh nonce. The DEK is then wrapped for each recipient with the SAME
// PBKDF2 -> AES-GCM construction used for text secrets, so each recipient
// recovers it locally from their PIN alone. The raw DEK never reaches the
// server; recipients.encrypted_data stores only the wrapped key, which means
// all existing per-recipient security logic applies unchanged.

export const FILE_KEY_LENGTH = KEY_LENGTH / 8; // 32 bytes

export function generateFileKey(): Uint8Array {
  return getRandomBytes(FILE_KEY_LENGTH);
}

async function importRawAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  return subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt raw bytes with a raw AES-256-GCM key. A fresh nonce is generated
// for every call and returned alongside the ciphertext.
export async function encryptBytesWithRawKey(
  data: Uint8Array,
  rawKey: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonceB64: string }> {
  const subtle = getSubtle();
  const key = await importRawAesKey(rawKey);
  const nonce = generateNonce();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
    key,
    toArrayBuffer(data),
  );
  return { ciphertext: new Uint8Array(ct), nonceB64: base64Encode(nonce) };
}

export async function decryptBytesWithRawKey(
  ciphertext: Uint8Array,
  rawKey: Uint8Array,
  nonceB64: string,
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await importRawAesKey(rawKey);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64Decode(nonceB64)), tagLength: 128 },
    key,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(plain);
}

// Wrap the file key for one recipient: identical construction to
// encryptSecret but for a small binary payload. Produces exactly the row
// shape already stored per-recipient (encryptedData/nonce/salt/iterations).
export async function wrapFileKeyForRecipient(
  fileKey: Uint8Array,
  pin: string,
  customIterations?: number,
): Promise<{
  encryptedData: string;
  nonce: string;
  salt: string;
  iterations: number;
}> {
  const subtle = getSubtle();
  const salt = generateSalt();
  const nonce = generateNonce();
  const iterations = customIterations || ITERATIONS;
  const key = await deriveKey(pin, salt, iterations);
  const wrapped = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
    key,
    toArrayBuffer(fileKey),
  );
  return {
    encryptedData: base64Encode(new Uint8Array(wrapped)),
    nonce: base64Encode(nonce),
    salt: base64Encode(salt),
    iterations,
  };
}

// Recover the raw file key from a wrapped bundle using the recipient's PIN.
// Throws on a wrong PIN (GCM authentication failure), like decryptSecret.
export async function unwrapFileKeyWithPin(
  encryptedDataB64: string,
  nonceB64: string,
  saltB64: string,
  iterations: number,
  pin: string,
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await deriveKey(pin, base64Decode(saltB64), iterations);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64Decode(nonceB64)), tagLength: 128 },
    key,
    toArrayBuffer(base64Decode(encryptedDataB64)),
  );
  return new Uint8Array(plain);
}

// Export constants for use elsewhere
export {
  ITERATIONS,
  KEY_LENGTH,
  SALT_LENGTH,
  NONCE_LENGTH,
  PIN_LENGTH,
  MAX_PIN_ATTEMPTS,
};
