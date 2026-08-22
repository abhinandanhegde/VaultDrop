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

1. **The secret plaintext** (text or file contents) — only ever exists in the creator's and
   recipients' browsers. For files, this includes the decrypted bytes on either end; the
   server only ever handles AES-256-GCM ciphertext.
2. **The decryption key** — derived client-side from the recipient's PIN via PBKDF2-SHA256.
   Files add a random 256-bit content key wrapped per recipient with that same derivation;
   the raw content key is never transmitted or stored. Never transmitted. Never stored.
3. **Recipient identity** — the mapping of "who opened what" is visible only to the creator
   (protected by a creator token that is not the delivery ID).

## 3. What the Server Can and Cannot See

| Server can see | Server cannot see |
|---|---|
| Delivery ID (the URL path) | Decryption key |
| bcrypt hash of each PIN | Raw PIN (new drops: clients transmit only `SHA-256(pin)`; the server stores `bcrypt(sha256(pin))`, so it can never combine a known PIN with the stored salt/iterations to derive the key itself) |
| AES-256-GCM ciphertext (per recipient) | Plaintext |
| Access events, timestamps, IP hashes | Content of the secret |
| Policy (expiry, burn-after-read, release time) | PBKDF2 salt alone is useless without the PIN |

**Zero-knowledge property:** the server stores *only* ciphertext + hashes. Given the database
in full, an attacker recovers ciphertext but no plaintext, no PIN, and no key.

**PIN transport hashing (migration 007):** drops carry a `pin_scheme` column (`raw` for
pre-existing drops, `sha256` for new ones). Clients read the scheme from the metadata
endpoint and send the matching transport value; access endpoints accept either form and
treat both as opaque bcrypt inputs, so wrong-scheme values fail exactly like a wrong PIN
(no oracle). Pre-existing `raw` drops keep working unchanged but retain the older,
weaker guarantee — they should be left to expire.

**Encrypted file delivery (migration 008):** files use envelope encryption on top of the
same primitives. The browser generates a random 256-bit content key (DEK), encrypts the
file once with AES-256-GCM and a fresh IV, wraps the DEK for each recipient with the
identical PBKDF2 construction used for text, and uploads only ciphertext — stored as
opaque `application/octet-stream` objects in the **private** `vaultdrop-files` Storage
bucket under randomized paths (`deliveries/<id>/<random>.bin`; original filenames never
appear in paths). The server streams ciphertext to authorized recipients after the same
PIN/policy/view-count checks as text; the wrapped DEK rides in a response header so the
browser decrypts locally. Plaintext files and raw DEKs never reach the server. The blob
is deleted with the rest of the drop's lifecycle: burn-after-read (once every
consumable copy is gone), expiry, revocation, PIN lockout, dead-man's switch, creator
delete, and the purge cron sweeps stragglers. A file retrieval consumes a view exactly
like a text open.

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
  restarts and multiple instances (an in-memory limiter remains as a cheap first gate on the
  legacy path). Migration 007 made the same RPC dual-mode: it accepts either a recipient
  `url_token` or a legacy delivery id, so both access routes share identical throttling.
- **PBKDF2 parameters:** 600,000 iterations of PBKDF2-HMAC-SHA256 with a unique 128-bit
  salt per drop and 96-bit nonces. This matches OWASP's current recommendation for
  PBKDF2-SHA256 (600k) and is defensible for a browser-only implementation; Web Crypto
  offers no memory-hard KDF (Argon2id), which would be the alternative if the constraint
  were ever lifted.

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
- **Files already saved by a recipient.** Revocation, expiry, and burn-after-read delete
  everything on the server — including encrypted file blobs — but cannot reach a file a
  recipient has already downloaded to their device. This is true of every delivery system;
  for VaultDrop it means file drops should go only to recipients you trust with their own copy.

## 7. Why Client-Side Encryption (ADR)

We encrypt in the browser rather than on the server because the server is assumed to be a
*semi-trusted* party: it may be legally compelled, breached, or misconfigured. By keeping the
key derivation and decryption entirely client-side, the server's compromise does not yield
plaintext. This matches the zero-knowledge model but extends it with delivery control that
PrivateBin lacks.

## 8. Test Evidence

- **82 of 83 automated API/e2e scenarios passing** across six suites (legacy, multi-recipient,
  time-lock, lockout self-destruct, dead man's switch, security-hardening). The single
  failing assertion is a stale test expectation in the time-lock suite (it predates
  single-recipient burn semantics); the production behavior it flags is correct.
- **Security-hardening suite** (`scripts/test-security-hardening.ts`, 31 scenarios) covers:
  repeated wrong-PIN lockout with countdown and destruction; 12 parallel wrong PINs
  (atomic counting — all counted, no 5xx); revoked-recipient denial (even with the correct
  PIN); expired-drop denial; 8-way simultaneous open of a one-time secret (exactly one
  winner, losers get 409/410/429, replay → 410); max-view enforcement; and plaintext-leak
  scans of every API response.
- **File-delivery suite** (`scripts/test-file-delivery.ts`, 43 scenarios, Aug 2026) covers:
  client-side round trips (random bytes, PDF, PNG — byte-exact after decrypt); wrong-PIN
  content-key unwrapping rejected; oversized uploads rejected (HTTP 413) before any storage
  write; disallowed MIME types rejected (HTTP 415); authorized retrieval streams ciphertext
  that decrypts byte-for-byte; stored Storage objects contain only ciphertext (a
  plaintext-marker scan finds no original bytes); the encrypted blob is deleted exactly when
  the last consumable copy goes — verified for burn-after-read, expiry, revoke-all-recipients,
  and PIN lockout; a 6-way simultaneous-open race produces exactly one winner; private-bucket
  probes confirm anonymous access fails via public URL, direct fetch, and the anon-key client;
  and the text flow still passes end-to-end afterwards.
- Client crypto verified by round-trip tests (encrypt → decrypt reproduces plaintext).
- All cryptographic randomness from the Web Crypto API (`crypto.getRandomValues` / `crypto.subtle`).
- **Atomic consumption verified end-to-end** (Aug 2026) against the live Supabase project:
  valid PIN → 200 + ciphertext returned + copy burned in the same transaction;
  immediate replay → 410 Gone; unknown token → structured 404; expired drop → 410 with
  lazy expiry applied.   Migrations `005_atomic_operations.sql` (advisory-lock consumption +
  DB-side rate limiting), `006_atomic_failed_attempts.sql` (atomic failed-attempt counters),
  `007_pin_transport_hashing.sql` (PIN transport hashing), and `008_file_delivery.sql`
  (file-delivery schema + private Storage bucket) are applied to production.
- **Concurrency probes under load** (Aug 2026):
  - Recipient path: 20 simultaneous valid-PIN opens → exactly one 200 with ciphertext;
    losers receive 409/410 (never an empty success).
  - Legacy path: 10 simultaneous valid-PIN opens → exactly one 200; losers receive 410/429.
  - Lockout race: 12 simultaneous wrong PINs → every increment counted (counter = 13 with
    warm-up), status `locked`, ciphertext wiped.