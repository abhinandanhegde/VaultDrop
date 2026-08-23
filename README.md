# VaultDrop

**VaultDrop is a policy-driven secure delivery platform for sensitive text and files — encrypted in the browser, governed by explicit access policy, and destructible by design.**

Security documentation: [`docs/threat-model.md`](docs/threat-model.md) · [`docs/technical-overview.md`](docs/technical-overview.md)

---

## The Idea

Most sharing tools treat content as a static blob behind a URL. VaultDrop models every payload — a text secret **or** an encrypted file — as a **delivery**: a governed object whose availability is decided by an explicit policy that the creator defines up front.

Every VaultDrop delivery answers five questions:

| Dimension | Question | Mechanism |
|---|---|---|
| **WHO** | Who is allowed to open it? | Recipient-specific links — each recipient gets their own URL, PIN, and independently encrypted copy |
| **HOW** | How is identity proven? | Out-of-band verification: the URL and a 6-digit PIN travel through **separate channels**, so intercepting one reveals nothing |
| **WHEN** | When can it be opened? | Server-enforced time-lock (stays sealed until the chosen moment) and configurable expiry |
| **HOW MANY TIMES** | How many opens are allowed? | Atomic max-view counting, including one-time burn-after-reading |
| **WHEN DESTROYED** | What ends it? | Creator revocation, per-recipient revocation, PIN-lockout destruction, dead-man's switch, or automatic expiry |

A secret in VaultDrop is not just ciphertext at an address. It is a policy-governed delivery whose state changes according to authorization, time, access count, and lifecycle conditions — enforced server-side on every request.

## Why This Is Different

Conventional secure-sharing tools are **content-centric**: the unit of work is "a blob plus a link." VaultDrop is **delivery-centric**: the unit of work is a multi-recipient dispatch whose each copy carries its own credentials, state, and lifecycle.

VaultDrop is an independent implementation inspired by the secure-information-sharing problem represented by [PrivateBin](https://privatebin.info/) — which establishes the baseline well: client-side encryption, zero server-side plaintext. VaultDrop preserves that essential purpose but introduces its own delivery model, architecture, and UX around it:

| Capability | Content-centric baseline | VaultDrop |
|---|---|---|
| Share mechanism | Link alone | URL **+** separate 6-digit PIN per open |
| Unit of control | One blob for everyone | One delivery → N recipients, each with an independent encrypted copy |
| Identity | Possession of link = access | Per-open PIN authentication, bcrypt-protected server-side |
| Scheduled access | No | Time-lock release enforced at the API |
| View limiting | No | Max views with race-safe atomic consumption |
| Revocation | Delete everything (manual) | Recall the whole drop **or** destroy one recipient's copy without touching others |
| Sender liveness | N/A | Dead man's switch: silence ⇒ self-destruction |
| Files | Rare / unencrypted-at-rest options | First-class envelope-encrypted file delivery under the same lifecycle model |

These controls are not independent toggles bolted onto a pastebin. They compose into one system: a delivery moves through a single state machine where every transition — release, open, lockout, revoke, expire, self-destruct — is a server-side decision recorded as an audit event, and every terminal transition deterministically destroys the ciphertext and any stored file blob.

## Core Features

### Secure Sharing
- Encrypted text secrets — AES-256-GCM, derived and applied entirely in the browser
- Encrypted file delivery — envelope encryption with per-recipient wrapped content keys
- Client-side encryption throughout — raw PINs, plaintext, and decryption keys never reach the server
- Private encrypted Storage — file ciphertext lives in a private bucket with randomized paths

### Access Control
- Recipient-specific access — up to 50 individually addressable copies per delivery
- Separate links and PINs — two-channel distribution defeats link forwarding
- PIN authentication — PINs are checked only as unrecoverable hashes; the typed digits never reach the server
- PIN lockout — 5 failed attempts destroy that copy server-side
- Rate limiting — database-backed sliding-window throttle on PIN attempts
- Creator revocation — recall an entire drop
- Recipient revocation — destroy a single copy, others unaffected

### Lifecycle Control
- Max views — counts stay exact even when many people open at once
- Burn-after-reading — one-time opens that erase themselves while serving
- Expiration — drops die at their deadline even if nobody visits
- Scheduled opening — time-locked releases enforced before authentication matters
- Dead man's switch — the creator must periodically renew or the drop self-destructs
- Destruction — every exit path converges on deterministic server-side deletion

### Reliability & Security
- Atomic consumption — database-level locking means simultaneous opens have exactly one winner
- Race-condition protection — failed-PIN counting that cannot lose track, no matter how many attempts land at once
- Row-Level Security — even someone holding database keys cannot read or modify delivery data
- Audit events — every attempt (successful or not) recorded with type, timestamp, and hashed IP
- Lifecycle cleanup — daily purge sweep plus lazy access-time enforcement

## How VaultDrop Works

```
Creator                     Server                          Recipient
───────                     ──────                          ─────────
Encrypt locally
Configure delivery policy
Create delivery ──────────► Validate · rate-limit
                            Store ciphertext +
                            hashed PIN + policy
Distribute URL + PIN  ════════════ out-of-band ════════════►  Receive link + PIN
                                                            Authenticate (PIN)
                             Check policy gates ◄──────────  Send hashed PIN
                             (time · views · state · rate)
                            Consume view atomically
                                                            Browser decrypts
Access consumed ◄────────── Destroy if policy says so       Read / download
Expire / Revoke /
Lock out / Self-destruct ► Deterministic deletion of
                            ciphertext + file blobs
```

1. **Encrypt locally** — the creator's browser derives keys from the PIN and encrypts before anything touches the network.
2. **Configure delivery policy** — who, when, how many times, what happens afterward.
3. **Create delivery** — the API validates, rate-limits, and persists ciphertext, PIN hashes, and policy. It returns per-recipient URLs and PINs for out-of-band distribution.
4. **Authenticate** — the recipient proves knowledge of the PIN; the URL alone grants nothing.
5. **Policy check** — the server evaluates time-lock, expiry, revocation, lockout, dead-man's-switch, and remaining views *before* releasing anything.
6. **Atomic consumption** — the view is decremented inside a locked transaction; burn-after-read destroys the copy in the same transaction that serves it.
7. **Decrypt locally** — the recipient's browser re-derives the key and decrypts; tampered content simply refuses to decrypt.
8. **Lifecycle continues** — expiry, revocation, lockout, or dead-man's-switch silence converge on destruction.

## Innovation: Policy-Driven Delivery

The primary innovation is **not** inventing cryptography. VaultDrop uses standard, well-analyzed primitives — AES-256-GCM, PBKDF2-SHA256, bcrypt — exactly as intended. The innovation is the application-level model that combines:

> **recipient identity + authentication + time constraints + view constraints + revocation + conditional destruction**

…into a single, coherent delivery lifecycle enforced by the server rather than promised by the UI.

A concrete delivery:

```
Secret:    "Production API credential"

Policy:
  WHO          → Alice (her own link + her own PIN)
  HOW          → 6-digit PIN, sent over a different channel than the link
  WHEN         → unlocks today at 8 PM
  HOW MANY     → maximum 2 views
  EXPIRY       → dies in 24 hours regardless
  AFTERWARD    → destroyed after final allowed view
```

Before 8 PM, even Alice with the correct PIN gets `423 Locked`. After two authorized opens, the copy is gone — a third attempt returns `410 Gone`, not a polite warning. If the creator recalls it at 9 PM, destruction is immediate and total. The identical model governs encrypted files: same policy surface, same gates, same destruction semantics — the only difference is envelope encryption around a larger payload.

This is the difference between "an encrypted pastebin with extra buttons" and a platform where sharing is a controlled, auditable process.

## Encrypted File Delivery

Files use envelope encryption so a single upload can serve multiple recipients without re-uploading or ever exposing the content key:

```
Browser
 ↓ generate random 256-bit content key (DEK)
 ↓ encrypt file once: AES-256-GCM(DEK, fresh 96-bit nonce)
 ↓ upload ciphertext → private Supabase Storage
 ↓ wrap DEK separately for EACH recipient (PBKDF2-SHA256 + AES-GCM)
 ↓ store wrapped copies + metadata in PostgreSQL
Recipient
  ↓ authenticate with PIN (same checks and limits as text)
  ↓ receive encrypted file + the key wrapped for them
  ↓ unwrap the key locally with their PIN → decrypt → download
```

Verified implementation properties:

- **256-bit random content key** per file; wrapped separately for each recipient — the raw key never reaches the server
- **Tamper-proof encryption** — any modification makes decryption fail instead of serving altered content
- Ciphertext stored in the **private `vaultdrop-files` bucket** as nameless binary data — no public download policies exist
- **Randomized object paths** (`deliveries/<deliveryId>/<random>.bin`) — original filenames never appear in storage
- The **plaintext file is never stored** — uploads and downloads carry encrypted bytes only; original name/type live solely as metadata returned to the authenticated recipient

## Security Architecture

In plain terms: content is scrambled inside your browser using a key made from the recipient's PIN; the server stores only unreadable data plus PIN hashes, and destroys both on schedule. The specifics:

**Cryptographic layer**

| Primitive | Role | Parameters |
|---|---|---|
| AES-256-GCM | Text + file encryption, DEK wrapping | 128-bit auth tags |
| PBKDF2-SHA256 | PIN → key derivation (text and file unwrap) | 600,000 iterations, 128-bit salt per copy |
| Nonces | Fresh per encryption | 96-bit |
| bcrypt | PIN hash at rest | Applied to `SHA-256(pin)` transport value |
| SHA-256 | PIN transport hashing | Raw PIN never leaves the browser on modern flows |

**Enforcement layer**

- **Row-Level Security** on all tables — anon keys cannot read or modify delivery data
- **Server-side authorization** — creator tokens (distinct from delivery IDs) gate management endpoints; recipient tokens gate exactly one copy
- **Database-backed PIN rate limiting** — sliding-window throttling that survives restarts and works across instances
- **Atomic consumption** — a PostgreSQL function holds a transaction-level advisory lock plus `FOR UPDATE` row locks during consumption; failed-attempt counting uses single-statement atomic updates
- **Private Storage** — no public bucket policies; access only through server routes holding service-role credentials
- **Service-role isolation** — privileged keys exist exclusively inside server-side API routes, never shipped to browsers

## Why Atomic Consumption Matters

Set **maximum views = 1** and suppose two requests arrive simultaneously:

```
Without atomic enforcement:          With VaultDrop:

Request A ──► check (1 left) ✓       Request A ──► acquires lock
Request B ──► check (1 left) ✓                     consume → 0 left
Both read the secret ✗               Request B ──► waits on row lock
                                                   sees 0 left → rejected ✓
```

The count, the burn, and the serving happen inside one locked database transaction — enforced at the database boundary, not by trusting frontend behavior or application-level checks. The security-hardening suite drives real concurrent opens against a live backend and asserts **exactly one winner** every time.

## Delivery Lifecycle

```
                    ┌─────────► ACTIVE
                    │              │
        time-lock elapses          │ access attempt
                    │              ▼
                    │    ┌── ACCESS (view consumed / file delivered)
   scheduled ───────┘    ├── LOCK (5 wrong PINs → copy destroyed)
                         ├── EXPIRE (deadline reached)
                         ├── REVOKE (creator or per-recipient)
                         ▼
                     DESTROYED — ciphertext wiped,
                     file blobs deleted, event logged
```

- **ACCESS** — policy gates pass; consumption is atomic; burn-after-read destroys in the same transaction that serves.
- **LOCK** — brute force is self-defeating: five failures erase the target copy.
- **EXPIRE** — evaluated lazily at access time (expired ⇒ wiped and `410`) *and* swept daily by the purge cron.
- **REVOKE** — creator-level (whole drop) or surgical (one recipient); others continue unaffected.
- **SELF-DESTRUCT** — dead-man's-switch deadline passes unrenewed ⇒ destruction on next touch and via daily sweep.
- **DESTROYED** — every path converges here deterministically: per-copy ciphertext erased, storage blobs deleted, audit event written.

## Testing & Reliability

**126/126 automated scenarios pass** across seven suites, run against a live Supabase backend:

| Suite | Result | Covers |
|---|---|---|
| Legacy | **4/4** | Single-recipient backward compatibility |
| Multi-recipient | **24/24** | Independent copies, per-recipient revocation, isolation |
| Time-lock | **9/9** | `423` before release, post-release behavior, validation rules |
| Lockout | **5/5** | Countdown, destruction after 5 failures |
| Dead man's switch | **10/10** | Renewal, deadline expiry, self-destruction |
| Hardening | **31/31** | Concurrency races (exactly-one-winner), parallel wrong-PIN counting, revoked/expired denial, plaintext-leak scans of every API response |
| File delivery | **43/43** | Byte-exact round-trips (PDF/PNG/random), wrong-PIN unwrap rejection, size/MIME enforcement, lifecycle blob deletion, 6-way open race, private-bucket denial probes |

Additional verification:

- TypeScript type-check: **PASS**
- ESLint: **0 errors**
- Production deployment: **LIVE** (Vercel)
- Browser end-to-end file-flow testing: **completed** (real browser: create → replace/remove interactions → deliver → decrypt → byte-exact download comparison → burn-after-read second visit)

### Performance (measured, not estimated)

Every timing below was recorded while actually using VaultDrop — creating deliveries, entering PINs, uploading files — against a live backend. Each number already includes all the security work (encryption, PIN checking, database updates).

| Action | Measured time |
|---|---|
| Encrypting a secret in the browser | ~0.2 s |
| Creating a delivery (click Send → link ready) | ~1.8–2 s |
| Opening a delivery (correct PIN → secret shown) | ~1.2 s |
| Rejecting a wrong PIN | ~1.3 s |
| Uploading a 1 MB encrypted file | 3–5 s |
| Downloading a 1 MB encrypted file | 4–5 s |
| Uploading / downloading a 5 MB encrypted file | ~4 s each |

Under pressure (also measured):

- **30 links opened at the same moment** → all 30 served in under 2 seconds.
- **10 people entered the correct PIN simultaneously for a "view once only" delivery** → exactly **1** got the content, the other 9 were refused. No copy leaked, nothing was double-opened.

These actions are not instant on purpose: every request runs real security work (PIN hashing, policy enforcement, locked database transactions). That trade-off keeps VaultDrop safe while staying comfortably responsive.

### Accessibility (verified, not claimed)

A real-browser audit ran 43 accessibility checks against both pages — **43 of 43 passed**:

- **Works without a mouse:** the whole product is operable by keyboard alone — composing and sending a delivery, picking files, typing the PIN, unlocking a secret.
- **Screen-reader friendly:** every button and field has a proper label; errors like a wrong PIN are announced out loud, including how many attempts remain.
- **Visible focus:** you can always see which control you're on when tabbing.
- **Readable text:** text contrast passes official WCAG standards in both light and dark themes.
- **Mobile-ready:** no sideways scrolling on phone screens; buttons are comfortably tappable.

Honest scope: this is targeted spot-checking of the main flows, not a certified full screen-reader audit. Two issues found during the audit were fixed immediately (an unlabeled toggle; a selector missing radio roles) — invisible changes, no design impact.

## Architecture

```
┌──────────────────────────────────────────────┐
│                   BROWSER                    │
│ creator: derive keys · encrypt · wrap DEKs   │
│ recipient: verify PIN · unwrap · decrypt     │
└──────────────────────┬───────────────────────┘
                       │ ciphertext only (+ SHA-256(pin))
                       ▼
┌──────────────────────────────────────────────┐
│             NEXT.JS APP ROUTER               │
│ React UI + API Routes: validation · bcrypt · │
│ rate limits · policy gates · atomic RPC      │
└──────────────┬───────────────┬───────────────┘
               │ service role  │ service role
               ▼               ▼
┌──────────────────────┐  ┌───────────────────────────┐
│ SUPABASE POSTGRESQL  │  │ SUPABASE STORAGE (PRIVATE)│
│ deliveries ·         │  │ vaultdrop-files bucket    │
│ recipients · policy  │  │ AES-GCM blobs only        │
│ wrapped keys · hashes│  │ application/octet-stream  │
│ audit events · RLS   │  │ randomized paths          │
└──────────────────────┘  └───────────────────────────┘
```

- **Browser** — all cryptography: derivation, encryption, wrapping, unwrapping, decryption.
- **Next.js API routes** — validation, PIN hashing/verification, rate limiting, policy gates, atomic RPC calls; the only tier holding service-role credentials.
- **PostgreSQL** — policy state, per-recipient ciphertext (text blobs + wrapped DEKs), hashes, audit events; RLS blocks non-service access.
- **Private Storage** — encrypted file blobs exclusively.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript |
| Styling/UI | Tailwind CSS · lucide-react · next-themes |
| Backend | Next.js API Routes (Node runtime) |
| Database | Supabase PostgreSQL (RLS, functions, advisory locks) |
| Storage | Supabase Storage — private bucket |
| Crypto | Web Crypto API (client) · bcryptjs (server) |
| Hosting | Vercel (+ Vercel Cron for nightly cleanup) |

## Project Structure

```
src/
  app/
    page.tsx                  creator UI (compose, policy, dispatch)
    r/[token]/page.tsx        recipient unlock/decrypt experience
    dashboard/[id]/page.tsx   creator dispatch board (status, events, revoke/renew)
    api/
      delivery/               creation, access, status, events, revoke, renew, delete
      delivery/file/          encrypted file creation (multipart)
      recipients/[token]/     recipient state machine, access, revoke
      purge/                  authenticated cleanup sweep
  components/                 envelope, PIN input, cards, theme, UI primitives
  lib/
    crypto.ts                 PBKDF2/AES-GCM/wrapping helpers (Web Crypto)
    storage.ts                private-bucket upload/download/delete
    ratelimit.ts              sliding-window limiter
    deadman.ts                renewal-deadline helpers
supabase/migrations/          001–008: schema, RLS, atomic ops, file storage
scripts/                      7 automated test suites (126 scenarios)
docs/                         technical overview + threat model
```

## Getting Started

```bash
# 1. Clone and install
git clone https://github.com/abhinandanhegde/VaultDrop.git
cd VaultDrop
npm install

# 2. Create a free Supabase project: https://supabase.com

# 3. Apply migrations 001–008 in order (Supabase SQL editor):
#    supabase/migrations/001_create_deliveries.sql       core tables + indexes + RLS
#    supabase/migrations/002_create_recipients.sql      per-recipient copies/tokens
#    supabase/migrations/003_add_release_at.sql         time-lock column
#    supabase/migrations/004_dead_man_switch.sql        renewal deadline columns
#    supabase/migrations/005_atomic_operations.sql      REQUIRED: atomic consumption +
#                                                       DB-backed PIN rate limiting
#    supabase/migrations/006_atomic_failed_attempts.sql contention-proof lockout
#    supabase/migrations/007_pin_transport_hashing.sql  pin_scheme + dual-mode limiter
#    supabase/migrations/008_file_delivery.sql          file columns + PRIVATE
#                                                       vaultdrop-files Storage bucket

# 4. Configure environment
cp .env.local.example .env.local   # fill in the variables below

# 5. Run
npm run dev                        # http://localhost:3000
```

## Environment Variables

| Variable | Visibility | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public configuration | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public configuration | Supabase anon key (RLS-restricted) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only secret** | Service-role access for API routes — bypasses RLS; never expose |
| `NEXT_PUBLIC_APP_URL` | Public configuration | Deployed app origin used for shareable links |
| `PURGE_SECRET` | **Server-only secret** | Auth token for `/api/purge` cron calls |

Never commit real values.

## Deployment

- **Frontend/API:** Vercel (Next.js App Router); environment variables set in project settings.
- **Database/Storage:** Supabase — apply migrations 001–008 once.
- **Cleanup cron:** `/api/purge` runs **daily at 03:00 UTC** (`vercel.json`: `0 3 * * *`), authenticated by `PURGE_SECRET`; it expires stale drops, deletes rows destroyed >30 days, sweeps leftover file blobs, and prunes old audit events.
- **Cron is hygiene, not enforcement:** expiry, time-lock, dead-man's-switch, lockout, and revocation are all evaluated **at access time** in the API routes. A missed cron run never extends a drop's life — it merely delays housekeeping.

## Security Model

Protections, in summary:

- **Confidentiality** — AES-256-GCM everywhere; keys derived client-side from PINs; the server stores ciphertext, wrapped keys, and hashes but cannot access plaintext content or decryption keys under this model.
- **Authentication** — bcrypt comparison of transport-hashed PINs; URL possession alone grants nothing.
- **Authorization** — separate creator and recipient tokens; RLS beneath everything.
- **Integrity** — authenticated encryption fails closed on any tampering.
- **Accountability** — audit events for created/accessed/failed/expired/revoked/locked/destroyed, with hashed IPs; visible to the creator for review.

Assumptions and the full analysis — including what the server can and cannot see — are documented in [`docs/threat-model.md`](docs/threat-model.md).

## Known Boundaries

Stated briefly:

- Downloaded/decrypted copies cannot be remotely controlled once saved to a recipient's device.
- Compromised recipient devices are outside the protection boundary.
- Client/browser compromise is outside the cryptographic model.
- The server necessarily sees operational metadata (titles, filenames, sizes, timing, hashed IPs) even though plaintext content and decryption material stay protected.

## Documentation

- [`docs/technical-overview.md`](docs/technical-overview.md) — engineering deep-dive: data model, crypto construction, atomic operations, lifecycle internals
- [`docs/threat-model.md`](docs/threat-model.md) — assets, adversaries, mitigations, residual risks

## Competition Context

VaultDrop is an independent implementation inspired by the secure-information-sharing problem represented by PrivateBin. It preserves the essential purpose of secure information sharing while introducing a policy-driven delivery model, recipient-specific controls, encrypted file delivery, and explicit lifecycle management.

## License

Provided without an open-source license. All rights reserved by the project authors.
