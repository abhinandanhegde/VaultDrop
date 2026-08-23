# VaultDrop

**Policy-driven controlled delivery for secrets and files — encrypted in the browser, enforceable on the server, destructible by design.**

Security documentation: [`docs/threat-model.md`](docs/threat-model.md) (strict threat model) · [`docs/technical-overview.md`](docs/technical-overview.md) (engineering detail).

---

## Problem

Ordinary secret and file sharing fails in predictable ways:

- **Links leak.** Anyone who obtains the link can usually open the content.
- **Access cannot be controlled.** After sending, the sender has no idea who opened what, when, or how many times.
- **Shared content outlives its purpose.** A paste, email attachment, or chat file typically remains available until someone manually deletes it — if deletion is even possible.
- **Files have no destruction story.** Ordinary file sharing offers no way to guarantee that the server-side copy is gone after delivery.
- **Senders lack lifecycle control.** There is no way to say "this unlocks tomorrow," "this dies if I go silent," or "only Alice may open this, once."

## Solution

VaultDrop treats every payload — a text secret **or** an uploaded file — not as static content but as a **controlled delivery** governed by an explicit policy:

```
WHO      → which specific recipients may open it (each with their own link + PIN)
HOW      → out-of-band verification: URL and 6-digit PIN travel separate channels
WHEN     → scheduled release (time-lock), optional expiry
HOW MANY → view limits, including one-time burn-after-reading
DESTROYED→ revocation, PIN-lockout destruction, dead-man's switch, purge cleanup
```

Encryption happens entirely in the browser before upload. The server enforces policy and stores only ciphertext-related state. Decryption happens entirely in the recipient's browser.

## Core Innovation

The innovation is the **delivery lifecycle / policy model**, not new cryptography.

VaultDrop uses standard, well-analyzed primitives — AES-256-GCM, PBKDF2-SHA256, bcrypt, PostgreSQL — exactly as their designers intended. What it adds is a coordinated control plane around them:

| | Conventional sharing / pastebin | VaultDrop |
|---|---|---|
| Payloads | Text (sometimes files) | Text secrets **and** encrypted files |
| Share mechanism | Link alone | URL **+** separate 6-digit PIN |
| Verification | None (possession of link = access) | PIN required per open |
| Per-recipient copies | No | Yes — each recipient has an independent encrypted copy |
| Creator control | None | Revoke whole drop or a single recipient; live status + timeline |
| View limiting | No | Max views incl. one-time burn-after-read |
| Scheduled access | No | Server-enforced time-lock release |
| Sender liveness | N/A | Dead man's switch self-destructs if the sender stops renewing |
| Destruction | Manual delete (maybe) | Deterministic server-side destruction wired into every lifecycle exit |

## Key Features

**Client-side encryption**
- Text secrets encrypted with AES-256-GCM in the browser before upload
- Key derived locally: PBKDF2-SHA256, 600,000 iterations, 128-bit random salt per copy, 96-bit nonce per encryption
- PIN transport hashing: new drops send `SHA-256(pin)` instead of the raw PIN; the server stores `bcrypt(sha256(pin))` and can never derive the decryption key itself

**Encrypted file delivery (envelope encryption)**
- Random 256-bit content key encrypts each file once; wrapped separately per recipient
- Ciphertext stored in a **private** Supabase Storage bucket (`vaultdrop-files`) as opaque `application/octet-stream`
- Randomized object paths — original filenames never appear in storage paths
- Plaintext files and raw content keys never reach the server

**Delivery policy**
- Separate URL + PIN verification
- Recipient-specific links, PINs, and encrypted copies (up to 50 per delivery)
- Recipient revocation without touching other recipients; creator revocation of a whole drop
- Max view counts (including one-time), burn-after-reading, expiration
- Scheduled opening (time-lock release, enforced server-side)
- Dead man's switch: renewal deadline; silence ⇒ self-destruction

**Server-side enforcement**
- bcrypt PIN verification (never plaintext)
- PIN lockout: 5 failed attempts destroys that copy server-side — nothing left to brute-force online
- Database-backed rate limiting (sliding-window, survives restarts and multi-instance deploys)
- Atomic consumption: PostgreSQL advisory locks + row locks make double-open races impossible
- Auditable access events for every attempt, successful or not

## Architecture

```
                ┌──────────────────────────────────────────┐
                │                BROWSER                    │
                │  creator: derive key, encrypt, wrap DEKs  │
                │  recipient: verify PIN, unwrap, decrypt   │
                └───────────────┬──────────────────────────┘
                                │  ciphertext only (+ SHA-256(pin))
                                ▼
                ┌──────────────────────────────────────────┐
                │            NEXT.JS API ROUTES             │
                │  validation · bcrypt · rate limits ·      │
                │  policy gates · atomic RPC calls          │
                └───────┬─────────────────────┬────────────┘
                        │ service role        │ service role
                        ▼                     ▼
        ┌───────────────────────┐   ┌────────────────────────────┐
        │   SUPABASE POSTGRES   │   │  SUPABASE STORAGE (PRIVATE)│
        │  metadata · policy ·  │   │  bucket: vaultdrop-files   │
        │  per-copy ciphertext  │   │  AES-GCM file blobs only,  │
        │  wrapped keys · hashes│   │  application/octet-stream  │
        │  audit events         │   │  randomized paths          │
        └───────────────────────┘   └────────────────────────────┘
              RLS enabled,               no public policies —
              anon blocked               service-role, server-side only
```

- Encryption and decryption happen **only in browsers**.
- PostgreSQL stores metadata, policy state, per-recipient ciphertext (text + wrapped keys), and audit events.
- Storage holds only encrypted file blobs.
- The service-role key exists exclusively inside server-side API routes; browsers never hold it.

## Text Encryption

**Creator**
1. Browser generates a random 6-digit PIN (rejection-sampled, unbiased) plus a fresh 128-bit salt and 96-bit nonce.
2. Derives the AES-256 key: `PBKDF2-SHA256(pin, salt, 600_000 iterations)`.
3. Encrypts: `AES-256-GCM(key, nonce, plaintext)` (128-bit auth tag).
4. Sends `{ciphertext, nonce, salt, iterations, SHA-256(pin), policy}` — the raw PIN never leaves the browser.
5. Server stores `bcrypt(sha256(pin))` + parameters + ciphertext; returns URL(s) + PIN(s) for out-of-band distribution.

**Recipient**
1. Opens the recipient URL → gets metadata only (title, policy, state) — no ciphertext.
2. Enters the PIN → browser sends `SHA-256(pin)`.
3. Server checks rate limit → verifies `bcrypt(sha256(pin))` → consumes the view atomically → returns the stored blob.
4. Browser re-derives the key locally from the **raw** PIN and decrypts via AES-256-GCM (tampering would fail tag verification).
5. If the policy says burn (one view reached), the server destroyed that copy in the same transaction that served it.

Multi-recipient drops repeat steps 1–4 once per recipient in the creator's browser, so every recipient has an independently encrypted copy under their own PIN.

## File Encryption

Envelope encryption, implemented end-to-end:

1. The browser generates a random **256-bit content key (DEK)**.
2. It encrypts the file **once**: `AES-256-GCM(DEK, fresh 96-bit nonce, file bytes)`.
3. For each recipient it **wraps the DEK** with that recipient's PIN using the identical construction as text secrets (`PBKDF2-SHA256` → `AES-GCM`). Each wrapped copy is independent.
4. Only the file ciphertext, wrapped keys, and metadata are uploaded (`POST /api/delivery/file`, multipart).
5. The private `vaultdrop-files` bucket stores the blob as `application/octet-stream` at a randomized path (`deliveries/<deliveryId>/<random>.bin`) — original filenames never appear in paths.
6. The recipient authenticates through the same access route used by text secrets (same rate limiting, PIN check, and atomic view consumption).
7. The server streams the ciphertext and returns the wrapped DEK in an `X-Vaultdrop-Meta` response header (base64url JSON).
8. The recipient's browser unwraps the DEK locally with their raw PIN and decrypts the file bytes; a download preserves the original filename.

Explicit guarantees (verified in code and tests):
- The **raw DEK never reaches the server** — only per-recipient wrapped copies do.
- The **plaintext file never reaches the server** — uploads and downloads carry AES-GCM ciphertext only.
- Stored objects are always `application/octet-stream`; the original MIME type lives only as database metadata.
- A file retrieval consumes a view exactly like a text open.

## Lifecycle

Delivery states: `active · accessed · locked · expired · revoked · destroyed`

| Control | Behavior |
|---|---|
| **Max views** | Consumption beyond the allowance is refused; counting is atomic under concurrency |
| **Burn-after-reading** | The consumed copy's ciphertext and PIN hash are wiped in the same transaction that serves it; when the last consumable copy goes, the delivery becomes `destroyed` and file blobs are deleted |
| **Expiration** | Enforced lazily at access time (expired drops are wiped and return `410`, regardless of cron); the daily purge also sweeps them |
| **Scheduled opening** | Before `release_at`, all access returns `423 Locked` — even with a valid PIN |
| **Revocation (creator)** | Whole drop recalled: status `revoked`, all copies wiped, file blob deleted |
| **Recipient revocation** | One recipient's copy destroyed independently; others unaffected |
| **Dead man's switch** | Renewal deadline passes without renewal → drop self-destructs on next touch *and* via daily sweep |
| **PIN lockout** | 5 failed attempts destroy that copy server-side (`locked` + `destroyed` events logged) |
| **Purge cleanup** | Daily Vercel cron expires stale drops, wipes leftover copies, deletes rows destroyed >30 days, removes orphaned blobs, prunes events older than 30 days |

## Security Model

- **Confidentiality:** AES-256-GCM everywhere; keys derived client-side from PINs. The server cannot access plaintext content or the decryption keys under the documented client-side encryption model.
- **Authentication:** bcrypt comparison of the PIN transport value; possession of the URL alone grants nothing.
- **Authorization:** creator token (distinct from the delivery ID) gates management endpoints; each recipient token gates exactly one copy.
- **Integrity:** GCM authenticated encryption — any tampering with ciphertext, nonce, salt, or wrapped keys fails decryption closed.
- **Lifecycle enforcement:** every policy gate is checked server-side at access time, inside the consumption transaction where applicable — not merely hidden in the UI.
- **Atomic operations:** consumption runs in a PostgreSQL function holding a transaction-level advisory lock plus `FOR UPDATE` row locks; failed-attempt counting uses single-statement atomic updates. Concurrent requests can never both consume a one-time secret.
- **Auditability:** auditable access events (`created`, `pin_validated`, `pin_failed`, `accessed`, `expired`, `revoked`, `locked`, `destroyed`) with timestamps and hashed-IP metadata, visible to the creator. These logs support accountability review; they are not cryptographic non-repudiation.

### What the server can and cannot see

| Server sees | Server does not get |
|---|---|
| Delivery IDs, recipient tokens, creator tokens | Raw PINs (new drops transmit only `SHA-256(pin)`) |
| `bcrypt(sha256(pin))` hashes | Decryption keys (derived in-browser from raw PINs) |
| Ciphertext: per-recipient text blobs, wrapped DEKs, file blobs | Plaintext secrets or file contents |
| File metadata: name, MIME type, size | Anything decryptable from stored bytes alone |
| Policy configuration and lifecycle state | |
| Access events: type, timestamp, IP hash | |

## Testing Evidence

**126/126 automated scenarios pass** across seven suites (run against a live Supabase backend):

| Suite | Scenarios | Covers |
|---|---|---|
| Legacy | 4/4 | Single-recipient backward compatibility |
| Multi-recipient | 24/24 | Independent copies, per-recipient revocation, isolation |
| Time-lock | 9/9 | 423 before release, release-after behavior, validation rules |
| Lockout | 5/5 | Countdown, destruction after 5 failures |
| Dead man's switch | 10/10 | Renewal, deadline expiry, self-destruction |
| Security hardening | 31/31 | Concurrency races (exactly-one-winner), parallel wrong-PIN counting, revoked/expired denial, plaintext-leak scans of every API response |
| File delivery | 43/43 | Round-trips (byte-exact PDF/PNG/random), wrong-PIN unwrap rejection, size/MIME enforcement, lifecycle blob deletion (burn/expiry/revoke/lockout), 6-way open race, private-bucket denial probes (public URL, direct fetch, anon-key client), text-flow regression |

Also: TypeScript type-check passes; ESLint reports 0 errors (1 pre-existing config warning).

## Setup

```bash
# 1. Clone and install
git clone https://github.com/abhinandanhegde/VaultDrop.git
cd VaultDrop
npm install

# 2. Create Supabase project (free tier works): https://supabase.com

# 3. Apply migrations IN ORDER (001–008) via the Supabase SQL editor:
#    supabase/migrations/001_create_deliveries.sql       core tables + indexes + RLS
#    supabase/migrations/002_create_recipients.sql      per-recipient copies/tokens
#    supabase/migrations/003_add_release_at.sql         time-lock column
#    supabase/migrations/004_dead_man_switch.sql        renewal deadline columns
#    supabase/migrations/005_atomic_operations.sql      REQUIRED: atomic consumption +
#                                                       DB-backed PIN rate limiting
#    supabase/migrations/006_atomic_failed_attempts.sql REQUIRED for contention-proof
#                                                       lockout (routes fall back to CAS)
#    supabase/migrations/007_pin_transport_hashing.sql  pin_scheme + dual-mode limiter
#    supabase/migrations/008_file_delivery.sql          file columns + PRIVATE
#                                                       vaultdrop-files Storage bucket

# 4. Configure environment
cp .env.local.example .env.local
# Fill in the five variables listed below, then:

# 5. Run
npm run dev
```

Open http://localhost:3000.

## Environment Variables

| Variable | Visibility | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public config | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public config | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only secret** | Service-role access for API routes; never expose to clients |
| `NEXT_PUBLIC_APP_URL` | Public config | Deployed app origin (used for shareable links) |
| `PURGE_SECRET` | **Server-only secret** | Auth token for `/api/purge`; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Never commit real values. The service-role key bypasses RLS — treat it accordingly.

## File Constraints

| Constraint | Value (as implemented) |
|---|---|
| Maximum size | **25 MiB** (`MAX_FILE_BYTES = 25 × 1024²`) — enforced in the UI before upload, at the API (`413`), and by the bucket itself (26,214,400 bytes) |
| Accepted types | `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `text/plain`, `text/csv`, `text/markdown`, `application/zip`, `application/x-zip-compressed`, `application/msword`, DOCX, `application/vnd.ms-excel`, XLSX, `application/vnd.ms-powerpoint`, PPTX; unknown/empty MIME treated as generic binary (`415` otherwise) |
| Stored as | Always `application/octet-stream` (ciphertext) |
| Path scheme | `deliveries/<deliveryId>/<random>.bin` — both components are cryptographically random; filenames are never exposed in paths |

## Deployment

- **Frontend/API:** Vercel (Next.js 15 App Router). Set all environment variables in the Vercel project settings.
- **Database/Storage:** Supabase. Apply migrations 001–008 once.
- **Purge cron:** configured in `vercel.json` — `/api/purge` runs **daily at 03:00 UTC** (`0 3 * * *`; Hobby-plan compatible), authenticated by `PURGE_SECRET`.
- **Cron is hygiene, not enforcement:** expiry, time-lock, dead-man's-switch, revocation, and lockout are all evaluated **at access time** in the API routes. A drop does not become dangerous if the cron hasn't run — it simply becomes unreachable and is wiped on first touch.

## Limitations

Stated plainly:

- **Downloaded files cannot be recalled.** Revocation and destruction remove everything server-side, but a file already saved to a recipient's device is gone from your control. Distribute files only to people you trust with their own copy.
- **Compromised devices are outside the model.** If a creator's or recipient's browser/OS is compromised, nothing in this architecture helps — the attacker sees what the user sees.
- **Malicious server-served JavaScript.** Like every browser-crypto system (PrivateBin included), an attacker who can modify the served bundle can steal decrypted content. Mitigated by static shipping and audit logging; documented as out of scope.
- **Metadata is visible to the server.** Titles, filenames, sizes, MIME types, policies, IPs (hashed), and event timelines are plaintext operational data. The server cannot access plaintext content or the decryption keys under the documented client-side encryption model — but it is not blind to metadata.
- **Short PINs are the weakest link.** 6-digit PINs resist online attack (rate limit + lockout destruction) but a full-database attacker with retained ciphertext could brute-force offline. Default burn-after-read, expiry, and lockout destruction exist specifically to minimize how long ciphertext survives.
- **Creation rate limiting is per-instance.** Delivery creation is capped at 10/hour/IP via an in-memory limiter (PIN-attempt throttling, by contrast, is database-backed).

## API Surface (summary)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/delivery` | POST | rate-limited | Create text delivery (single or up to 50 recipients) |
| `/api/delivery/file` | POST | rate-limited | Create encrypted file delivery (multipart) |
| `/api/delivery/[id]` | GET | public | Metadata only — never ciphertext |
| `/api/delivery/[id]/access` | POST | PIN | Legacy single-recipient access |
| `/api/delivery/[id]/status?token=` | GET | creator | Full status + recipient states |
| `/api/delivery/[id]/events?token=` | GET | creator | Audit-event timeline |
| `/api/delivery/[id]/revoke` | POST | creator | Recall entire drop (+ blob delete) |
| `/api/delivery/[id]/renew` | POST | creator | Extend dead-man's-switch deadline |
| `/api/delivery/[id]/delete` | POST | creator | Permanent delete (+ blob delete) |
| `/api/recipients/[token]` | GET | public | Per-recipient state machine view |
| `/api/recipients/[token]/access` | POST | PIN | Atomic consumption; text JSON or file stream + `X-Vaultdrop-Meta` |
| `/api/recipients/[token]/revoke` | POST | creator | Destroy one copy (+ conditional blob delete) |
| `/api/purge?secret=` | POST | `PURGE_SECRET` | Daily cleanup sweep |

Status codes on access: `200` ok · `403` wrong PIN (with remaining attempts) · `404` invalid · `410` gone/consumed/expired/revoked · `423` time-locked or locked-out · `429` rate limited · `409` concurrent-open contention.

## Development

```bash
npm run dev        # dev server (http://localhost:3000)
npm run build      # production build
npm run lint       # ESLint
npm run type-check # tsc --noEmit

# Test suites against a running dev server (default BASE_URL=http://localhost:3000):
BASE_URL=http://localhost:3000 node scripts/test-legacy.ts               # 4
BASE_URL=http://localhost:3000 node scripts/test-multi-recipient.ts      # 24
BASE_URL=http://localhost:3000 node scripts/test-time-lock.ts            # 9
BASE_URL=http://localhost:3000 node scripts/test-lockout.ts              # 5
BASE_URL=http://localhost:3000 node scripts/test-deadman.ts              # 10
BASE_URL=http://localhost:3000 node scripts/test-security-hardening.ts   # 31
BASE_URL=http://localhost:3000 node scripts/test-file-delivery.ts        # 43
```

## License

This repository is currently provided without an open-source license.
All rights reserved by the project authors.
