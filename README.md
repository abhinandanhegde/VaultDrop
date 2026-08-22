# VaultDrop — Secure Secret & File Delivery

> **Not a paste bin. A secret delivery workflow — for text secrets and files.**

> **Security documentation:** see [`docs/threat-model.md`](docs/threat-model.md) for the full
> threat model, attack scenarios, and honest limitations.
> A product-level summary lives in [`docs/technical-overview.md`](docs/technical-overview.md).

PrivateBin solves secure paste sharing. VaultDrop reinterprets the problem as **controlled temporary secret delivery**: create a secret *or upload a file*, define an access policy, share it via out-of-band verification (URL + PIN), and track the full lifecycle from creation to proven destruction.

## Core Innovation

| | PrivateBin | VaultDrop |
|---|---|---|
| **Model** | Secure paste (single action) | Secure delivery (workflow) |
| **Payloads** | Text pastes | Text secrets **and** encrypted files (PDFs, images, documents, archives) |
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
git clone https://github.com/abhinandanhegde/VaultDrop.git
cd VaultDrop
npm install

# Set up environment
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# Set up Supabase (free tier)
# 1. Go to https://supabase.com
# 2. Create new project
# 3. Run ALL SQL files in supabase/migrations/ IN ORDER (001 through 008).
#    Migration 005 adds the atomic PostgreSQL functions
#    (check_pin_rate_limit, consume_recipient_secret) required by the
#    recipient access route — skipping it causes HTTP 500 on open.
#    Migration 006 adds atomic failed-attempt counters
#    (record_failed_attempt, record_failed_attempt_delivery) — the routes
#    fall back to optimistic CAS without it, but the RPC is contention-proof.
#    Migration 007 adds the pin_scheme column and makes the PIN rate limiter
#    dual-mode; new drops hash PINs client-side (SHA-256) before transport.
#    Migration 008 adds file-delivery columns and creates the PRIVATE
#    vaultdrop-files Storage bucket (25 MiB limit) for encrypted file blobs.
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
┌─────────────────┐  AES-256-GCM   ┌─────────────────┐   service role   ┌──────────────────┐
│    Browser      │ ←→  PBKDF2     │  Next.js API    │ ──────────────→  │ Supabase Storage │
│   (Client)      │  (600K iters)  │   Routes        │                  │ (PRIVATE bucket: │
│                 │                │                 │                  │ vaultdrop-files, │
│ encrypt ○       │                │ Store blob /    │                  │ ciphertext only) │
│ decrypt ○       │                │ Validate PIN    │                  └──────────────────┘
└─────────────────┘                └────────┬────────┘
                                            │
                                            ▼
                                     ┌───────────────┐
                                     │ Supabase PG   │
                                     │               │
                                     │ ciphertext +  │
                                     │ hashes only   │
                                     └───────────────┘
```

### Security Properties

1. **Zero-knowledge:** AES-256-GCM encryption in the browser. The server stores only ciphertext — for text secrets *and* for files.
2. **Out-of-band verification:** URL and PIN are distributed via separate channels.
3. **PIN as password:** the raw PIN drives PBKDF2 key derivation locally; the server only ever receives a bcrypt-validated value. New drops transmit `SHA-256(pin)` instead of the raw digits, so the server stores `bcrypt(sha256(pin))` and can never derive the key itself.
4. **One-time access:** consumption runs inside a PostgreSQL function with a
   transaction-level advisory lock (`pg_try_advisory_xact_lock`) and `FOR UPDATE` row
   locks — concurrent requests can never both read the secret; the first wins, the rest get 410.
5. **Encrypted file delivery (envelope scheme):** each file is encrypted once with a random 256-bit content key, which is then wrapped per recipient with the same PBKDF2 construction as text secrets. Ciphertext is stored in a **private** Storage bucket under randomized paths; plaintext files and content keys never reach the server. Blob deletion is wired into every lifecycle exit (burn, expiry, revoke, lockout, dead-man's switch, delete, purge cron).
6. **Creator control:** creator token allows revocation and deletion before access.
7. **Access logging:** all events (successful or failed) are recorded with timestamp.
8. **Rate limiting + lockout self-destruct:** max 5 failed PIN attempts, then the recipient's encrypted copy is destroyed server-side (nothing left to brute-force offline). The attempt window is enforced atomically in the database (`check_pin_rate_limit` RPC), so it survives process restarts and multi-instance deploys.
9. **Auto-expiration:** expired deliveries are automatically purged (cron job).
10. **Time-lock release:** optional scheduled unlock enforced server-side (before `release_at`, access returns HTTP 423 even with a valid PIN).
11. **Dead man's switch:** optional renewal deadline. If the creator doesn't renew via the dispatch board before the deadline, every copy of the secret is destroyed server-side — the drop can never be opened by anyone.

### What the server knows (and what it doesn't):

| Server knows | Server does NOT know |
|---|---|
| Delivery ID (URL) | Decryption key |
| bcrypt hash of PIN (`bcrypt(sha256(pin))` on new drops) | Raw PIN |
| Encrypted ciphertext (text and file blobs) | Decrypted plaintext |
| File metadata: name, MIME type, size | File contents (only AES-GCM ciphertext is stored) |
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
| File storage | Supabase Storage — private `vaultdrop-files` bucket, ciphertext only |
| PIN hashing | bcryptjs (on server only) |
| Deployment | Vercel + Supabase Edge |
| KDF | PBKDF2-SHA256, 600K iterations (NIST SP 800-63B / OWASP) |

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
  "recipients": [{ "id": "<uuid>", "urlToken": "<token>", "pin": "<transport value>" }]
}
```
> Note: `recipients[].pin` echoes the transport value submitted at creation time
> (`SHA-256(pin)` for new drops). It is not the raw PIN — creators share PINs out-of-band.

### `POST /api/delivery/file`
Create an encrypted **file** delivery. `multipart/form-data`:

| Part | Contents |
|---|---|
| `file` | AES-256-GCM ciphertext of the file (uploaded as `application/octet-stream`) |
| `meta` | JSON: `{ title, recipients: [{ name, pin, wrapped }], maxViews, expiresAt, burnAfterReading, releaseAt, renewalWindowMinutes, fileName, fileMime, fileNonce }` |

`wrapped` is the per-recipient wrapped content key `{ encryptedData, nonce, salt, iterations }`,
produced client-side with the same PBKDF2 construction used for text secrets. The raw
content key never leaves the browser.

**Server-side validation:** size ≤ 25 MiB (HTTP 413), MIME type allowlist (HTTP 415),
plus the same recipient/PIN/policy rules as the text route. The Storage object and
database rows are created atomically — any failure cleans up both.

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

**Request body:** `{ "pin": "<raw 6-digit or SHA-256 hex>" }`

**Flow:** server-side rate-limit check (`check_pin_rate_limit` RPC) → bcrypt PIN
validation → atomic consumption (`consume_recipient_secret` RPC, advisory-locked).

- **Text secrets:** returns the recipient's encrypted blob as JSON. If burned after
  read → `destroyed: true` and the ciphertext is wiped in the same transaction.
- **Files:** returns `application/octet-stream` raw ciphertext with the wrapped content
  key and file metadata in the `X-Vaultdrop-Meta` response header (base64url JSON). The
  browser unwraps the key locally and decrypts. When the burn condition fires and no
  consumable copy remains, the Storage blob is deleted before the response is sent.

**Status codes:** 200 ok · 403 wrong PIN (with remainingAttempts) · 404 invalid ·
410 gone/destroyed/expired · 423 locked-out or time-locked · 429 rate limited.

### `POST /api/recipients/[token]/revoke`
Destroy one recipient's copy without touching other recipients (creator only).

### `GET /api/purge?secret=<PURGE_SECRET>`
Delete expired deliveries. Called by cron.

## Sending Files

| Constraint | Value |
|---|---|
| Max size | **25 MiB** (enforced in the UI *before* upload, at the API, and by the bucket) |
| Types | PDF, PNG/JPEG/GIF/WebP, TXT/CSV/Markdown, ZIP, DOC(X), XLS(X), PPT(X) |
| Storage | Private `vaultdrop-files` bucket, randomized path `deliveries/<id>/<random>.bin` |
| Object content type | Always `application/octet-stream` (ciphertext; original MIME kept as metadata only) |

**Lifecycle:** a file retrieval consumes a view exactly like a text open. When a burn
condition fires, the encrypted blob is deleted server-side once no consumable recipient
copy remains — the same rule that governs text ciphertext. Blob deletion is also wired
into expiry, revocation, PIN lockout, dead-man's-switch destruction, creator deletion,
and the purge cron.

**Honest limitation:** VaultDrop can delete everything on the server, but it cannot
recall a file already downloaded to a recipient's device. Distribute files only to
people you trust with their own copy.

## Crypto Flow

```
CREATOR (text):
1. Generate random 6-digit PIN → "847291"
2. Generate 128-bit salt, 96-bit nonce
3. Derive key: PBKDF2("847291", salt, 600K iterations) → AES-256 key
4. Encrypt: AES-256-GCM(key, nonce, plaintext) → ciphertext
5. Send to server: {ciphertext, nonce, salt, iterations, SHA-256(pin), policy}
   → Server stores bcrypt(SHA-256(pin)) + policy only (raw digits never sent)
6. Creator receives: URL (delivery_id) + PIN (send via separate channels)

RECIPIENT (text):
1. Open URL → server returns {status, title, policy} (no encrypted data)
2. Enter PIN → client sends SHA-256(pin) to /api/recipients/[token]/access
3. Server validates bcrypt(SHA-256(pin)) → if valid, returns encrypted blob
4. Client derives key: PBKDF2(raw PIN, salt, iterations) → AES-256 key
5. Client decrypts: AES-256-GCM(key, nonce, ciphertext) → plaintext
6. If one-time delivery → server destroys encrypted data

CREATOR (file):
1. Generate random 256-bit content key (DEK)
2. Encrypt file once: AES-256-GCM(DEK, fresh nonce, bytes) → ciphertext
3. For each recipient: wrap DEK = AES-256-GCM(PBKDF2(their PIN, salt), DEK)
4. Upload ciphertext + wrapped keys + metadata → /api/delivery/file
   → Server stores blob in private Storage + bcrypt(sha256(pin)) per recipient
5. Raw DEK and plaintext file never leave the browser

RECIPIENT (file):
1. Open URL → metadata shows filename/type/size (no content)
2. Enter PIN → same access route; view consumed by the same atomic RPC
3. Server authorizes, streams ciphertext; wrapped DEK rides in X-Vaultdrop-Meta header
4. Client unwraps DEK locally: PBKDF2(raw PIN, salt) decrypts wrapped bundle
5. Client decrypts file bytes: AES-256-GCM(DEK, file nonce) → original file
6. "Download File" saves it; server-side copy deleted per lifecycle rules
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
npm run dev        # Start dev server (http://localhost:3000)
npm run build      # Production build
npm run lint       # Run ESLint
npm run type-check # TypeScript type check

# Test suites (server must be running; default BASE_URL=http://localhost:3003)
BASE_URL=http://localhost:3003 node scripts/test-legacy.ts               # 4 scenarios
BASE_URL=http://localhost:3003 node scripts/test-multi-recipient.ts      # 24 scenarios
BASE_URL=http://localhost:3003 node scripts/test-time-lock.ts            # 9 scenarios
BASE_URL=http://localhost:3003 node scripts/test-lockout.ts              # 5 scenarios
BASE_URL=http://localhost:3003 node scripts/test-deadman.ts              # 10 scenarios
BASE_URL=http://localhost:3003 node scripts/test-security-hardening.ts   # 31 scenarios
BASE_URL=http://localhost:3003 node scripts/test-file-delivery.ts        # 43 scenarios
```

**Current status: 125 of 126 scenarios passing.** The single failing assertion is a stale
expectation in the time-lock suite that predates burn-after-read semantics — the production
behavior it flags is correct. See `docs/threat-model.md` §8 for details.

## License
This repository is currently provided without an open-source license.
All rights reserved by the project authors.
