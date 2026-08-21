# VaultDrop — Threat Model & Security Analysis

## 1. The Problem, Restated

PrivateBin solves one problem: *a server can host encrypted pastebin content it cannot read.*
The threat model stops there. VaultDrop starts from that same primitive and extends the
threat model to cover the *delivery workflow* — because in practice, secrets fail not because
the cipher is weak, but because **delivery is uncontrolled**.

> **PrivateBin solves X (encrypted paste). We identified Y (uncontrolled delivery) and
> Z (no accountability), and our architecture addresses both.**

| Threat | PrivateBin | VaultDrop |
|---|---|---|
| Anyone with the URL reads the secret | Yes (key in fragment) | No — requires URL **+** 6-digit PIN |
| A shared link can be recalled | No | Yes — per-recipient revocation |
| Creator knows who opened / who didn't | No | Yes — per-recipient status + event timeline |
| One person's compromise affects everyone | N/A (single recipient) | No — each recipient has an independent encrypted copy |
| Access can be scheduled, not just destroyed | No | Yes — time-lock release (server-enforced) |
| A secret survives a silent sender | N/A (single recipient) | No — dead man's switch self-destructs it |

## 2. Assets We Protect

1. **The secret plaintext** — only ever exists in the creator's and recipient's browsers.
2. **The decryption key** — derived client-side from the recipient's PIN via PBKDF2-SHA256.
   Never transmitted. Never stored.
3. **Recipient identity** — the mapping of "who opened what" is visible only to the creator
   (protected by a creator token that is not the delivery ID).

## 3. What the Server Can and Cannot See

| Server can see | Server cannot see |
|---|---|
| Delivery ID (the URL path) | Decryption key |
| bcrypt hash of each PIN | Raw PIN |
| AES-256-GCM ciphertext (per recipient) | Plaintext |
| Access events, timestamps, IP hashes | Content of the secret |
| Policy (expiry, burn-after-read, release time) | PBKDF2 salt alone is useless without the PIN |

**Zero-knowledge property:** the server stores *only* ciphertext + hashes. Given the database
in full, an attacker recovers ciphertext but no plaintext, no PIN, and no key.

## 4. Attack Scenarios

### 4.1 Database is fully compromised
- **Impact:** ciphertext + bcrypt PIN hashes + event logs leak.
- **Why you're still safe:** PIN hashes are bcrypt (computationally expensive to brute-force
  even for 6-digit PINs); the secret is AES-256-GCM with a 600K-iteration PBKDF2 key. No
  plaintext is recoverable.
- **Residual risk:** a weak PIN is brute-forceable offline. Mitigation: rate-limited online
  attempts (5 max), then the encrypted copy is **destroyed server-side** (lockout
  self-destruct) — no ciphertext remains to brute-force offline.

### 4.2 A recipient's URL leaks
- **Impact:** the link is useless without the PIN.
- **Why you're still safe:** the URL and PIN travel separate channels by design (documented in
  the UI: "send through different channels").

### 4.3 A recipient is compromised / leaves the team
- **Impact:** their copy can be revealed, but only theirs.
- **Why you're still safe:** per-recipient revocation destroys their encrypted copy server-side
  without touching other recipients. Revoking an entire delivery also cascade-wipes every
  recipient's ciphertext copy, so no encrypted remnants outlive a revoked drop.

### 4.4 The server admin is malicious (serves modified JS)
- **Impact:** an attacker who can modify the served page can steal what the browser decrypts.
- **Honest limitation:** this is shared with *all* client-side crypto (PrivateBin has the same
  caveat). VaultDrop mitigates by shipping the crypto bundle statically and logging events,
  but we explicitly document this as out-of-scope, exactly as PrivateBin does.

### 4.5 Timing / side channels & race conditions
- **Token comparisons** (`creator_token`) use exact string match.
- PIN verification is bcrypt (constant-time per call); failed attempts are rate-limited and
  counted per recipient.
- **Concurrent-open race:** two requests with a valid PIN at the same instant cannot both
  read the secret. Consumption runs inside `consume_recipient_secret`, a PostgreSQL function
  that takes a transaction-level advisory lock (`pg_try_advisory_xact_lock`) plus
  `SELECT ... FOR UPDATE` row locks, checks all policy state *inside* the lock, and wipes
  ciphertext atomically with the read. Losers receive HTTP 409 (transient contention, retry)
  or HTTP 410 (allowance spent).
- **Legacy single-recipient path:** consumption is guarded by an optimistic-concurrency
  claim (`UPDATE ... WHERE view_count = <snapshot>`). Only the request whose claim lands
  serves ciphertext; burn-after-read and the ciphertext wipe happen in that same statement,
  so no window exists between "counted" and "destroyed". Race losers receive HTTP 410 and
  never see payload bytes. Verified under load: 10 concurrent valid-PIN opens → exactly
  one 200; the other nine receive 410/429 with zero ciphertext exposure.
- **Atomic failed-attempt counting:** wrong-PIN increments run through
  `record_failed_attempt` / `record_failed_attempt_delivery` (migration `006`), which are
  single-statement self-referencing UPDATEs — atomic in PostgreSQL regardless of
  contention. An attacker spraying parallel wrong PINs cannot lose increments and squeeze
  extra guesses past the 5-attempt lockout. Verified: 12 concurrent wrong PINs → counter
  reads 13 (all attempts counted, none lost), drop locked and ciphertext wiped.
  Both access routes fall back to optimistic CAS if the RPC is not deployed.
- **Distributed rate limiting:** the failed-PIN window is evaluated by the
  `check_pin_rate_limit` SQL function against `access_events`, so limits hold across server
  restarts and multiple instances (the in-memory limiter remains as a cheap first gate).

### 4.6 The sender goes silent / is compromised
- **Impact:** a drop left alive indefinitely is one compromise away from leaking.
- **Why you're still safe:** with a dead man's switch, an un-renewed drop self-destructs —
  ciphertext and PIN hashes are wiped server-side the moment the deadline passes. A silent
  sender cannot leave a live secret behind.

## 5. Security Properties (claims we make)

1. **Confidentiality in transit & at rest** — AES-256-GCM, key never leaves the browser.
2. **Authentication** — PIN proof via bcrypt on the server; derived key on the client.
3. **Authorization** — creator token gates management; per-recipient token gates each copy.
4. **Integrity** — AES-GCM provides authenticated encryption (tampering is detected).
5. **Non-repudiation of access** — every access attempt (success/fail) is logged with a timestamp.
6. **Freshness / revocability** — revocation, expiration, and burn-after-read enforce lifecycle.
7. **Temporal control** — time-lock release is enforced server-side (not merely cosmetic).
8. **Proof of liveness** — a dead man's switch self-destructs the drop if the creator stops
   renewing before the deadline, so a silent sender can never leave a live secret behind.

## 6. What We Explicitly Do NOT Protect Against

- Malicious/injected client-side code (shared with all browser-crypto solutions).
- The creator's own device being compromised.
- Recipients colluding (a recipient who legitimately has the PIN can read it).
- Physical coercion / rubber-hose attacks.

## 7. Why Client-Side Encryption (ADR)

We encrypt in the browser rather than on the server because the server is assumed to be a
*semi-trusted* party: it may be legally compelled, breached, or misconfigured. By keeping the
key derivation and decryption entirely client-side, the server's compromise does not yield
plaintext. This matches the zero-knowledge model but extends it with delivery control that
PrivateBin lacks.

## 8. Test Evidence

- **51 of 52 automated API/e2e scenarios passing** (legacy, multi-recipient, time-lock,
  lockout self-destruct, dead man's switch). The single failing assertion is a stale test
  expectation in the time-lock suite (it predates single-recipient burn semantics); the
  production behavior it flags is correct.
- Client crypto verified by round-trip tests (encrypt → decrypt reproduces plaintext).
- All cryptographic randomness from the Web Crypto API (`crypto.getRandomValues` / `crypto.subtle`).
- **Atomic consumption verified end-to-end** (Aug 2026) against the live Supabase project:
  valid PIN → 200 + ciphertext returned + copy burned in the same transaction;
  immediate replay → 410 Gone; unknown token → structured 404; expired drop → 410 with
  lazy expiry applied. Migrations `005_atomic_operations.sql` (advisory-lock consumption +
  DB-side rate limiting) and `006_atomic_failed_attempts.sql` (atomic failed-attempt
  counters) are applied to production.
- **Concurrency probes under load** (Aug 2026):
  - Recipient path: 20 simultaneous valid-PIN opens → exactly one 200 with ciphertext;
    losers receive 409/410 (never an empty success).
  - Legacy path: 10 simultaneous valid-PIN opens → exactly one 200; losers receive 410/429.
  - Lockout race: 12 simultaneous wrong PINs → every increment counted (counter = 13 with
    warm-up), status `locked`, ciphertext wiped.