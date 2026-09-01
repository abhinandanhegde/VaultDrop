# VaultDrop

> Policy-driven secure delivery for sensitive text and files — encrypted in the browser, governed by explicit access policy, and self-destructible by design.

**Live app → [vaultdrop-quadsquad.vercel.app](https://vaultdrop-quadsquad.vercel.app)** · [Threat Model](docs/threat-model.md) · [Technical Overview](docs/technical-overview.md)

---

## 30-Second Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VaultDrop Model                             │
│                                                                     │
│   WHO           Recipient-specific links (each gets own URL + PIN)  │
│   HOW           6-digit PIN sent over a SEPARATE channel than URL   │
│   WHEN          Server-enforced time-lock (sealed until chosen time)│
│   HOW MANY      Atomic view counting, including one-time burn       │
│   WHEN DESTROYED  Revocation · lockout · expiry · dead-man's switch │
└─────────────────────────────────────────────────────────────────────┘
```

The server **never sees plaintext or raw PINs**. All encryption happens in your browser. The server stores only unreadable ciphertext, PIN hashes, and metadata — and destroys everything on schedule.

---

## Quick Demo Script

> For judges: full end-to-end walkthrough in under 3 minutes.

1. **Create a drop** → type a secret (or upload a file) → add 1–2 recipients → set expiry to 5 minutes → click "Send."
2. **Open the dashboard** → copy a recipient link → paste in new incognito window → enter the PIN.
3. **Verify burn-after-read** → go back to dashboard → the recipient card turns green "Opened" → try the link again → you see "Already opened."
4. **Revocation** → go to dashboard → revoke the second recipient → refresh → their card shows "Revoked."
5. **Time-lock** → create a new drop with release time 2 minutes ahead → open recipient link → see countdown timer → wait → PIN entry appears after unlock.
6. **Dead-man's switch** → create a drop with 3-minute renewal window → dashboard shows "Renew" button → stop renewing → link self-destructs.

---

## What Makes VaultDrop Different

| Capability | Typical sharing tools | VaultDrop |
|---|---|---|
| Share mechanism | Link alone | **URL + separate 6-digit PIN** per open |
| Unit of control | One blob for everyone | **One delivery → N recipients**, each independently encrypted |
| Identity | Possession of link = access | **Per-open PIN authentication**, bcrypt-verified server-side |
| Scheduled access | No | **Server-enforced time-lock release** |
| View limiting | No | **Atomic maximum-view enforcement** — exact under concurrency |
| Revocation | Manual delete-everything | **Whole-delivery or surgical per-recipient** destruction |
| Sender liveness | N/A | **Dead-man's switch** — silence ⇒ self-destruction |
| Files | Rare / unencrypted-at-rest | **First-class encrypted file delivery** via envelope encryption |
| Lifecycle end | Manual deletion | **Unified lifecycle** — every exit path destroys ciphertext deterministically |

---

## Feature Matrix

### Secure Sharing
- AES-256-GCM text secrets — derived and applied entirely in the browser
- Envelope encryption for files — one upload, N recipient-specific wrapped keys
- Client-side encryption — raw PINs, plaintext, and decryption keys never reach the server
- Private encrypted storage — file ciphertext in a private bucket under randomized paths

### Access Control
- Up to 50 individually addressable copies per delivery
- Separate links and PINs — two-channel distribution defeats link forwarding
- PIN authentication — bcrypt compared as unrecoverable hashes
- PIN lockout — 5 wrong attempts destroy that recipient's copy
- Database-backed rate limiting — sliding-window throttle across instances
- Creator-level and per-recipient revocation

### Lifecycle Control
- Maximum-view enforcement with atomic database consumption
- Burn-after-read — one-time opens that erase themselves while serving
- Expiration — deliveries die at their deadline regardless of visits
- Time-lock release — sealed until chosen moment, enforced before authentication
- Dead-man's switch — periodic renewal required or delivery self-destructs
- Deterministic destruction — ciphertext wiped, blobs deleted, events logged

### Reliability & Security
- Atomic consumption — PostgreSQL advisory lock + `FOR UPDATE` guarantees exactly-one-winner
- Row-Level Security on all tables — anon keys cannot read or modify delivery data
- Audit events — every attempt (successful or not) recorded with type, timestamp, and hashed IP
- Lifecycle cleanup — daily purge sweep plus at-access enforcement

---

## Architecture

```
BROWSER (all crypto)          SERVER (Next.js API)           STORAGE
─────────────────             ─────────────────────          ───────
Key derivation                Validation                     PostgreSQL
Encryption                    Authentication                 (RLS enabled)
Key wrapping                  Authorization                   Private bucket
Decryption                    Policy gates                    (encrypted blobs)
                              Rate limiting
                              Atomic operations
                                    │
                    ────────────────┼────────────────
                    Server NEVER holds plaintext, raw PINs,
                    or decryption keys
```

### Cryptographic Primitives

| Primitive | Role | Parameters |
|---|---|---|
| AES-256-GCM | Text + file encryption, key wrapping | 128-bit auth tags |
| PBKDF2-SHA256 | PIN → key derivation | 600,000 iterations, 128-bit salt per copy |
| bcrypt | PIN hash at rest | Applied to SHA-256(pin) transport value |
| SHA-256 | PIN transport hashing | Raw PIN never leaves browser |

---

## Testing

> **126 / 126 automated scenarios pass** — seven suites against a live Supabase backend.

| Suite | Scenarios | Covers |
|---|:---:|---|
| Legacy | 4 | Single-recipient backward compatibility |
| Multi-recipient | 24 | Independent copies, per-recipient revocation, isolation |
| Time-lock | 9 | 423 before release, post-release, validation |
| Lockout | 5 | Countdown, destruction after 5 failures |
| Dead man's switch | 10 | Renewal, deadline, self-destruction |
| Hardening | 31 | Concurrency races, parallel wrong-PIN counting, plaintext-leak scans |
| File delivery | 43 | Byte-exact round-trips, wrong-PIN rejection, lifecycle blob deletion, 6-way open race |

### Performance (measured against live backend)

| Action | Time |
|---|---|
| Encrypt secret in browser | ~0.2 s |
| Create delivery (click → link ready) | ~1.8–2 s |
| Open delivery (correct PIN → shown) | ~1.2 s |
| Wrong PIN rejection | ~1.3 s |
| Upload / download 1 MB file | 3–5 s / 4–5 s |
| 30 simultaneous opens | All served in <2 s |
| 10 simultaneous PIN attempts on one-view delivery | Exactly 1 winner |

---

## Project Structure

```
src/
  app/
    page.tsx                        Creator UI — compose, policy, dispatch
    r/[token]/page.tsx              Recipient unlock/decrypt
    dashboard/[id]/page.tsx         Dispatch board — status, events, revoke
    api/health/route.ts             Health endpoint
    api/delivery/                   Creation, access, status, events, revoke, renew
    api/recipients/[token]/         Recipient state, access, revoke
    api/purge/                      Cleanup sweep
  components/                       Envelope, PIN input, GlassCard, theme, UI
  lib/
    crypto.ts                       PBKDF2 / AES-GCM / wrapping (Web Crypto)
    storage.ts                      Private-bucket upload/download/delete
    ratelimit.ts                    Sliding-window limiter
supabase/migrations/                001–008: schema, RLS, atomic ops, file storage
scripts/                            7 automated test suites (126 scenarios)
docs/                               Technical overview + threat model
```

---

## Getting Started

```bash
git clone https://github.com/abhinandanhegde/VaultDrop.git
cd VaultDrop
npm install

# 1. Create a free Supabase project at https://supabase.com
# 2. Apply migrations 001–008 in order via the SQL editor
# 3. Copy .env.local.example → .env.local and fill in:
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL, PURGE_SECRET
# 4. npm run dev
```

---

## Deployment

| Component | Platform |
|---|---|
| Frontend / API | Vercel (Next.js App Router) |
| Database / Storage | Supabase PostgreSQL + private bucket |
| Cleanup cron | `/api/purge` daily at 03:00 UTC (Vercel Cron) |

Cron is housekeeping, not enforcement: all policy checks happen at access time in the API routes. A missed cron never extends a delivery's life.

---

## License

Provided without an open-source license. All rights reserved by the project authors.
