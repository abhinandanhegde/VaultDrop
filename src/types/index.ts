export interface Delivery {
  id: string;
  // Encrypted content fields (server never sees plaintext)
  encryptedData: string;    // base64 AES-256-GCM ciphertext
  nonce: string;            // base64 nonce (96-bit)
  salt: string;             // base64 PBKDF2 salt (128-bit)
  iterations: number;       // PBKDF2 iterations (default 600000)
  pinHash: string;          // bcrypt hash of PIN
  // Access policy
  maxViews: number;         // 0 = unlimited, 1 = burn-after-read
  expiresAt?: string | null; // ISO timestamp or null for no expiry
  burnAfterReading: boolean;
  // Creator control
  creatorToken: string;     // UUID for creator operations
  // Status tracking
  status: 'active' | 'accessed' | 'expired' | 'revoked' | 'destroyed' | 'locked';
  viewCount: number;
  failedAttempts: number;
  // Metadata
  title?: string | null;
  contentType: string;
  createdAt: string;
  accessedAt?: string | null;
  destroyedAt?: string | null;
}

export interface AccessEvent {
  id: string;
  deliveryId: string;
  eventType: 'pin_validated' | 'pin_failed' | 'accessed' | 'expired' | 'revoked' | 'destroyed' | 'locked';
  eventTime: string;
  metadata?: Record<string, unknown> | null;
}

export interface CreateDeliveryRequest {
  encryptedData: string;
  nonce: string;
  salt: string;
  iterations: number;
  pinHash: string;
  maxViews?: number;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
  title?: string;
  contentType?: string;
}

export interface CreateDeliveryResponse {
  status: 'ok' | 'error';
  id?: string;
  creatorToken?: string;
  message?: string;
}

export interface AccessRequest {
  pin: string;
}

export interface AccessResponse {
  status: 'ok' | 'error';
  data?: {
    encryptedData: string;
    nonce: string;
    salt: string;
    iterations: number;
    contentType: string;
    title?: string | null;
  };
  message?: string;
  remainingAttempts?: number;
}

export interface DeliveryStatus {
  status: 'ok' | 'error';
  data?: {
    id: string;
    status: string;
    title?: string | null;
    contentType: string;
    maxViews: number;
    viewCount: number;
    expiresAt?: string | null;
    burnAfterReading: boolean;
    createdAt: string;
    accessedAt?: string | null;
    destroyedAt?: string | null;
  };
  message?: string;
}

export interface AccessEventData {
  id: string;
  deliveryId: string;
  eventType: string;
  eventTime: string;
  metadata?: Record<string, unknown> | null;
}

export type Theme = 'light' | 'dark' | 'system';
