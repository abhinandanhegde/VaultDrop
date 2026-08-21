# VaultDrop — Secure Secret Delivery Agent

> **Not a paste bin. A secret delivery workflow.**

> **Security documentation:** see [`docs/threat-model.md`](docs/threat-model.md) for the full
> threat model, attack scenarios, and honest limitations.

PrivateBin solves secure paste sharing. VaultDrop reinterprets the problem as **controlled temporary secret delivery**: create a secret, define an access policy, share it via out-of-band verification (URL + PIN), and track the full lifecycle from creation to proven destruction.

## Core Innovation

| | PrivateBin | VaultDrop |
|---|---|---|
| **Model** | Secure paste (single action) | Secure delivery (workflow) |
| **Share mechanism** | URL with key in `#fragment` | URL + separate 6-digit PIN |
| **Verification** | Anyone with URL can access | Recipient must enter PIN |
| **Creator control** | None | Revoke, delete, view status |
| **Access tracking** | None | Full event timeline |
| **Delivery confirmation** | None | Creator gets timestamped proof |
| **Scheduled access** | None | Time-lock release (server-enforced) |
| **Proof of liveness** | None | Dead man's switch (self-destructs if sender goes silent) |

## Quick Start

```bash
# Clone and install
git clone your-repo-url
cd vaultdrop
npm install

# Set up environment
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# Set up Supabase (free tier)
# 1. Go to https://supabase.com
# 2. Create new project
# 3. Run ALL SQL files in supabase/migrations/ IN ORDER (001 through 006).
#    Migration 005 adds the atomic PostgreSQL functions
#    (check_pin_rate_limit, consume_recipient_secret) required by the
#    recipient access route — skipping it causes HTTP 500 on open.
#    Migration 006 adds atomic failed-attempt counters
#    (record_failed_attempt, record_failed_attempt_delivery) — the routes
#    fall back to optimistic CAS without it, but the RPC is contention-proof.
# 4. Copy project URL and anon key to .env.local
# 5. Get service_role key from Project Settings > API

# Set purge secret (for auto-expiration cron)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
┌─────────────────┐    AES-256-GCM    ┌─────────────────┐
│    Browser      │ ←→ PBKDF2         │  Next.js API    │
│   (Client)      │    (600K iters)   │   Routes        │
│                 │                   │                 │
│   encrypt ○     │                   │  Store blob     │
│   decrypt ○     │                   │  Validate PIN   │
└─────────────────┘                   └────────┬────────┘
                                               │
                                               ▼
                                        ┌───────────────┐
                                        │ Supabase PG   │
                                        │               │
                                        │  encrypted_   │
                                        │  data only    │
                                        └───────────────┘
```

### Security Properties

1. **Zero-knowledge:** AES-256-GCM encryption in the browser. Server stores only ciphertext.
2. **Out-of-band verification:** URL and PIN are distributed via separate channels.
3. **PIN as password:** The PIN is used for both PBKDF2 key derivation (on client) and bcrypt validation (on server). Server stores only bcrypt hash.
4. **One-time access:** Consumption runs inside a PostgreSQL function with a
   transaction-level advisory lock (`pg_try_advisory_xact_lock`) and `FOR UPDATE` row
   locks — concurrent requests can never both read the secret; the first wins, the rest get 410.
5. **Creator control:** Creator token allows revocation and deletion before access.
6. **Access logging:** All events (successful or failed) are recorded with timestamp.
7. **Rate limiting + lockout self-destruct:** Max 5 failed PIN attempts, then the recipient's
   encrypted copy is destroyed server-side (nothing left to brute-force offline). The attempt
   window is enforced atomically in the database (`check_pin_rate_limit` RPC), so it survives
   process restarts and multi-instance deploys.
8. **Auto-expiration:** Expired deliveries are automatically purged (cron job).
9. **Time-lock release:** Optional scheduled unlock enforced server-side (before `release_at`,
   access returns HTTP 423 even with a valid PIN).
10. **Dead man's switch:** Optional renewal deadline. If the creator doesn't renew via the
    dispatch board before the deadline, every copy of the secret is destroyed server-side —
    the drop can never be opened by anyone.

### What the server knows (and what it doesn't):

| Server knows | Server does NOT know |
|---|---|
| Delivery ID (URL) | Decryption key |
| bcrypt hash of PIN | Raw PIN |
| Encrypted ciphertext | Decrypted plaintext |
| Access events (timestamps) | Content of the secret |
| Delivery policy (max views, expiry) | |
| Creator token | |

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Crypto | Web Crypto API (AES-256-GCM, PBKDF2-SHA256) |
| Database | Supabase (PostgreSQL) |
| PIN hashing | bcryptjs (on server only) |
| Deployment | Vercel + Supabase Edge |
| KDF | PBKDF2-SHA256, 600K iterations (NIST SP 800-63B) |
| PIN hashing | bcryptjs (on server only) |

## API Reference

### `POST /api/delivery`
Create a new secure delivery.

**Request body (single recipient, legacy):**
```json
{
  "encryptedData": "<base64 ciphertext>",
  "nonce": "<base64 nonce>",
  "salt": "<base64 salt>",
  "iterations": 600000,
  "pin": "847291",
  "maxViews": 1,
  "expiresAt": "2026-08-20T15:32:00Z",
  "burnAfterReading": true,
  "title": "Database password",
  "contentType": "text/plain"
}
```

**Request body (multi-recipient):** pass `"recipients"` instead of the legacy fields:
```json
{
  "title": "Database password",
  "recipients": [
    { "name": "Alice", "pin": "847291", "encryptedData": "...", "nonce": "...", "salt": "..." },
    { "name": "Bob",   "pin": "930112", "encryptedData": "...", "nonce": "...", "salt": "..." }
  ]
}
```
Each recipient gets an independent encrypted copy, URL token, and PIN.

**Response:**
```json
{
  "status": "ok",
  "id": "<deliveryId>",
  "creatorToken": "<creatorToken>",
  "recipients": [{ "id": "<uuid>", "urlToken": "<token>", "pin": "847291" }]
}
```

### `GET /api/delivery/[id]`
Get delivery metadata (public).

**Response:** Delivery status, title, policy — but NOT encrypted content.

### `POST /api/delivery/[id]/access`
Validate PIN and return encrypted blob (if valid).

**Request body:** `{ "pin": "847291" }`

**Response:** If PIN valid → encrypted blob + metadata. If destroyed after access → `destroyed: true`.

### `GET /api/delivery/[id]/status?token=<creatorToken>`
Get full delivery status (creator only).

### `GET /api/delivery/[id]/events?token=<creatorToken>`
Get access event timeline (creator only).

### `POST /api/delivery/[id]/revoke`
Revoke delivery before access (creator only).

### `POST /api/delivery/[id]/renew`
Push the dead man's switch deadline forward by the renewal window (creator only).

### `POST /api/delivery/[id]/delete`
Permanently delete delivery (creator only).

### `GET /api/recipients/[token]`
Get recipient-specific drop metadata (public). Returns state: `pending`, `opened`,
`destroyed`, `expired`, `revoked`, `locked`, `not_released`, or `deadman`.

### `POST /api/recipients/[token]/access`
Recipient PIN validation + atomic consumption for a single copy.

**Request body:** `{ "pin": "847291" }`

**Flow:** server-side rate-limit check (`check_pin_rate_limit` RPC) → bcrypt PIN
validation → atomic consumption (`consume_recipient_secret` RPC, advisory-locked) →
returns the recipient's encrypted blob. If burned after read → `destroyed: true`
and the ciphertext is wiped in the same transaction.

**Status codes:** 200 ok · 403 wrong PIN (with remainingAttempts) · 404 invalid ·
410 gone/destroyed/expired · 423 locked-out or time-locked · 429 rate limited.

### `POST /api/recipients/[token]/revoke`
Destroy one recipient's copy without touching other recipients (creator only).

### `GET /api/purge?secret=<PURGE_SECRET>`
Delete expired deliveries. Called by cron.

## Crypto Flow

```
CREATOR:
1. Generate random 6-digit PIN → "847291"
2. Generate 128-bit salt, 96-bit nonce
3. Derive key: PBKDF2("847291", salt, 600K iterations) → AES-256 key
4. Encrypt: AES-256-GCM(key, nonce, plaintext) → ciphertext
5. Send to server: {ciphertext, nonce, salt, iterations, PIN, policy}
   → Server hashes PIN with bcrypt, stores hash + policy only
6. Creator receives: URL (delivery_id) + PIN (send via separate channels)

RECIPIENT:
1. Open URL → server returns {status, title, policy} (no encrypted data)
2. Enter PIN → send to /api/delivery/[id]/access
3. Server validates PIN (bcrypt) → if valid, returns encrypted blob
4. Client derives key: PBKDF2(PIN, salt, iterations) → AES-256 key
5. Client decrypts: AES-256-GCM(key, nonce, ciphertext) → plaintext
6. If one-time delivery → server destroys encrypted data
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_APP_URL` | Yes | Your deployed URL |
| `PURGE_SECRET` | Yes* | Secret string for purge cron job |

*The purge secret should be a long random string. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Auto-Purge Setup

Set up a cron job to call the purge endpoint daily:

```bash
# Example cron entry (runs at 3 AM UTC daily)
0 3 * * * curl -X POST "https://your-app.vercel.app/api/purge?secret=YOUR_PURGE_SECRET"
```

Or use a service like [cron-job.org](https://cron-job.org) or GitHub Actions scheduled workflow.

## Development

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # Run ESLint
npm run type-check # TypeScript type check
```

## License
This repository is currently provided without an open-source license.
All rights reserved by the project authors.
