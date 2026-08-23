# VaultDrop — Threat Model & Security Analysis

> Scope: the VaultDrop delivery system as implemented (migrations 001–008, `src/lib/*`, API routes, private Storage bucket). Every claim below is tied to code or to one of the seven automated suites (**126/126 scenarios passing**). Companion docs: [`../README.md`](../README.md), [`technical-overview.md`](technical-overview.md).

## 1. Model and Assets

VaultDrop extends the encrypted-paste primitive (PrivateBin) from *static content* to a **controlled delivery lifecycle**: per-recipient verification, view limiting, scheduled release, sender-liveness, and deterministic destruction.

Assets protected:

1. **Plaintext content** (text secrets; file bytes) — exists only in creators'/recipients' browsers.
2. **Key material** — text keys are derived in-browser via PBKDF2-SHA256 from raw PINs; file DEKs are random 256-bit values wrapped per recipient under the same construction. Neither is transmitted or stored in recoverable form. (In short: unlocking always requires a recipient's actual PIN, computed only on their device.)
3. **Access accountability** — who opened what is visible only to the creator, gated by a `creator_token` distinct from any shareable identifier.

## 2. What the Server Can and Cannot See

| Server sees | Server does not get |
|---|---|
| Delivery IDs, recipient `url_token`s, creator tokens | Decryption keys (derived client-side from raw PINs) |
| `bcrypt(sha256(pin))` hashes + PBKDF2 salts / iteration counts | Raw PINs on new drops (`SHA-256(pin)` is the transport value) |
| Ciphertext: per-recipient text blobs, wrapped DEKs, Storage file blobs | Plaintext secrets or file contents |
| File metadata: name, MIME type, size | Anything decryptable from stored bytes alone |
| Policy configuration, lifecycle state, counters | |
| Access events: type, timestamp, IP value, failure reasons | |

**The server cannot access plaintext content or the decryption keys under the documented client-side encryption model.** It does see metadata, ciphertext, and hashes — VaultDrop's claim is precisely scoped, not "the server knows nothing."

Cryptographic parameters as implemented: AES-256-GCM (128-bit auth tags); PBKDF2-HMAC-SHA256 with 600,000 iterations, a unique 128-bit salt and a fresh 96-bit nonce per encryption; bcrypt PIN-hash verification; SHA-256 PIN transport hashing (`pin_scheme='sha256'`); atomic PostgreSQL operations (transaction-level advisory locks, `FOR UPDATE` row locks, single-statement counter updates); database-backed sliding-window rate limiting; envelope encryption for files; a private Storage bucket with no access policies.

## 3. Threat Analysis

Format: **Threat → Attack scenario → Mitigation → Evidence → Residual risk.** Read each entry as: how an attack would work, what stops it, proof that the defense works, and what risk honestly remains.

### 3.1 Database compromise
- **Scenario:** attacker obtains a full dump of `deliveries`, `recipients`, `access_events`, plus all Storage objects.
- **Mitigation:** only ciphertext, wrapped keys, bcrypt hashes, and metadata exist there. Text/file keys require raw PINs (600k-iteration PBKDF2 per guess). New drops never expose raw PINs to the server at all. Lockout destruction and burn-after-read minimize how long ciphertext survives to be attacked offline.
- **Evidence:** hardening + file suites scan every API response for plaintext leakage; round-trip tests confirm stored bytes are GCM ciphertext only; wrong-PIN unwrap attempts fail closed.
- **Residual risk:** a 6-digit PIN space (10⁶ candidates) is brute-forceable offline given retained ciphertext (~6×10¹¹ SHA-256 ops per copy on typical hardware). Default burn-after-read, expiry, and lockout destruction exist to shrink that window; unconsumed long-lived drops remain the weakest-link case.

### 3.2 URL / token leakage
- **Scenario:** a share link is intercepted, forwarded, or scraped.
- **Mitigation:** links carry no key material (keys derive from PINs, not URLs — unlike fragment-key schemes); access additionally requires the PIN; creators can revoke instantly; tokens are 128-bit random values, not enumerable IDs.
- **Evidence:** multi-recipient suite verifies wrong-PIN denial independent of a valid token; revocation tests confirm immediate refusal.
- **Residual risk:** if URL *and* PIN travel the same insecure channel, both can leak together — out-of-band distribution is a procedural control the UI reinforces but cannot enforce.

### 3.3 PIN leakage
- **Scenario:** PIN guessed from context (birthdays), reused elsewhere, or sent over the same channel as the URL.
- **Mitigation:** unbiased rejection-sampled digit generation; UI instructs separate-channel distribution; transport hashing means a server-side observer of requests sees `sha256(pin)` — replayable as an authentication value, but useless for deriving the PBKDF2 key, which requires the raw digits.
- **Evidence:** migration 007 + `pin_scheme` enforcement in create/access routes; crypto unit tests cover `hashPinForTransport`.
- **Residual risk:** a disclosed raw PIN defeats protection for that recipient until burn/revocation; VaultDrop cannot detect disclosure.

### 3.4 Online PIN brute force
- **Scenario:** attacker iterates PIN guesses against a recipient link.
- **Mitigation:** database-backed sliding window (5 failed attempts per IP per drop in 15 minutes → `429` + `Retry-After`, computed by the `check_pin_rate_limit` SQL function over audit events); independently, the 5th counted failure destroys that copy server-side — nothing remains to attack.
- **Evidence:** lockout suite 5/5 (countdown, destruction); hardening suite validates DB-backed throttling semantics across "restarts."
- **Residual risk:** distributed sources reach the cap faster than one source can — but the total of 5 failures still destroys the copy regardless of source count.

### 3.5 Parallel failed-PIN attempts (lost increments)
- **Scenario:** spraying concurrent wrong PINs hoping read-modify-write races lose increments, squeezing extra guesses past the limit.
- **Mitigation:** counting uses a single self-referencing atomic `UPDATE … RETURNING` (migration 006; `SECURITY DEFINER`; execute revoked from public/anon/authenticated, granted to service_role only); an optimistic-CAS fallback preserves correctness if the RPC were absent.
- **Evidence:** hardening suite: 12 simultaneous wrong PINs → counter reads 13 (every attempt counted, none lost), drop locked and wiped, zero 5xx.
- **Residual risk:** none identified beyond §3.4.

### 3.6 Concurrent valid opens of a one-time secret
- **Scenario:** multiple parties submit the correct PIN simultaneously, each expecting to extract the "one-time" secret.
- **Mitigation:** consumption runs inside `consume_recipient_secret`: a transaction-level advisory lock (`pg_try_advisory_xact_lock`) plus `SELECT … FOR UPDATE` row locks on recipient and delivery; all policy state is re-checked inside the lock; burn wipes key material in the same transaction that serves bytes. Losers receive structured errors mapped to HTTP 409/410. The legacy route uses optimistic CAS on the `view_count` snapshot — only the winning statement serves ciphertext.
- **Evidence:** hardening suite: 20-way simultaneous valid-PIN open → exactly one `200`, losers get 409/410/429, replay → 410; file suite: 6-way race → exactly one winner; re-verified end-to-end through the real browser UI (10 simultaneous correct-PIN opens of a max-views=1 drop → exactly 1 winner served ciphertext, 9 structured rejections, winner decrypted correctly client-side).
- **Residual risk:** none within the model.

### 3.7 View-count races (multi-view deliveries)
- **Scenario:** racing requests attempt to exceed `max_views`.
- **Mitigation:** each consumption increments counts exactly once inside the locked path; allowance exhaustion triggers the burn branch atomically.
- **Evidence:** multi-recipient and hardening suites exercise max-view enforcement under concurrency.
- **Residual risk:** none identified.

### 3.8 Revocation races (revoke vs. in-flight access)
- **Scenario:** an access request passes pre-checks while a revoke lands, then still serves ciphertext.
- **Mitigation:** status is re-evaluated **inside** the consumption lock (`delivery_invalid` / `locked` error paths); revoke routes wipe copies immediately and delete file blobs (unconditionally for whole-drop revoke, conditionally once no live copies remain for single-recipient revoke); revoked recipients are refused even with the correct PIN.
- **Evidence:** hardening suite: revoked-recipient denial with correct PIN; revoke tests confirm key-material wipes.
- **Residual risk:** a response already in flight at the moment of revocation may deliver that one copy — inherent to distributed systems; every subsequent attempt fails.

### 3.9 Expiration races (expiry vs. access)
- **Scenario:** a request arrives at the expiry boundary hoping to ride a stale allow decision.
- **Mitigation:** the expiry gate runs **before any PIN work** in both access routes, performs the lazy `expired` transition, wipes key material, deletes file blobs, and returns `410`; the daily purge sweep catches untouched stragglers.
- **Evidence:** hardening suite: expired-drop denial; deadman suite covers deadline-driven transitions.
- **Residual risk:** inter-instance clock skew could extend life by the skew duration; Supabase/Vercel run NTP-synced clocks.

### 3.10 Recipient compromise
- **Scenario:** one recipient turns malicious or their device is seized.
- **Mitigation:** per-recipient independent copies bound exposure to that recipient; creator revokes that single link without touching others; each copy has its own PIN and ciphertext.
- **Evidence:** multi-recipient suite: isolation and individual-revocation scenarios.
- **Residual risk:** whatever that recipient legitimately decrypted — or already downloaded — is beyond recall (§4).

### 3.11 Creator compromise
- **Scenario:** attacker seizes the creator's device or the `creator_token` to hijack or surveil deliveries.
- **Mitigation:** the creator token gates management endpoints only (status, events, revoke, renew, delete); it grants no decryption ability — plaintext still requires each recipient's PIN.
- **Evidence:** authorization checks on every management route; events route scopes timeline visibility to the token.
- **Residual risk:** whoever controls the creator's device can recall/delete deliveries and read anything displayed there; the creator endpoint is inside the trust boundary by definition.

### 3.12 Malicious server-served JavaScript
- **Scenario:** infrastructure or build pipeline compromise serves altered client bundles that exfiltrate PINs or decrypted content.
- **Mitigation:** static bundle shipping, no runtime code injection, audit logging for forensics.
- **Evidence:** architectural property; not testable from inside the system.
- **Residual risk:** such an attack is fully effective against any browser-crypto design — PrivateBin documents the identical caveat; VaultDrop lists it as out of scope rather than denying it.

### 3.13 Direct Storage access
- **Scenario:** attacker attempts public object URLs, unauthenticated fetches, or the anon-key SDK client against `vaultdrop-files`.
- **Mitigation:** bucket is `public=false` with **no `storage.objects` policies** — anon/authenticated roles are denied by default; only service-role API routes touch objects; object names are random and never exposed except after authorization.
- **Evidence:** file-delivery suite probes all three vectors and asserts denial; migration 008 encodes the bucket configuration.
- **Residual risk:** possession of the service-role key (i.e., server compromise) bypasses storage controls entirely — that is the declared trust boundary of §1.

### 3.14 Ciphertext tampering
- **Scenario:** attacker modifies stored blobs, ciphertext, salts/nonce fields, or wrapped keys seeking parser exploits or confusion.
- **Mitigation:** AES-256-GCM authenticated encryption at both layers (text payloads; wrapped DEKs; file bytes) — any modification fails tag verification and decryption throws closed; `enc_version` guards future format evolution.
- **Evidence:** byte-exact round-trip tests; wrong-key/wrong-PIN unwrap rejection tests.
- **Residual risk:** denial-of-service only — a tampered drop becomes undecryptable.

### 3.15 Dead-man's-switch failure (silent sender)
- **Scenario:** creator disappears expecting the secret to die; or an attacker bets the deadline is cosmetic.
- **Mitigation:** the deadline is enforced at access time — the next touch destroys the delivery row, all recipient copies, and the file blob — *and* by the daily purge sweep even if nobody ever touches it. Renewal requires an explicit creator action.
- **Evidence:** dead-man's-switch suite 10/10 (renewal extension, deadline expiry, destruction).
- **Residual risk:** between deadline and first touch/purge the row exists but is unreadable (access path destroys it before serving anything).

### 3.16 File lifecycle deletion
- **Scenario:** encrypted file blobs linger after their drop should be gone (burned, expired, revoked, locked out, deleted, or swept).
- **Mitigation:** deletion is wired into every lifecycle exit: burn-after-read removes the blob once no consumable recipient copy remains (`deliveryHasLiveCopies` check); whole-drop revocation, creator deletion, dead-man's-switch destruction, and lazy expiry remove it unconditionally; the daily purge additionally expires stale actives (deleting blobs), wipes recipients of expired drops, deletes rows dead >30 days with a blob sweep, and prunes old events. Missing objects mid-access yield `410` plus a `destroyed` audit event rather than errors.
- **Evidence:** file-delivery suite asserts blob absence after burn-after-read, expiry, revoke-all-recipients, and PIN lockout, including the "last live copy" conditional logic.
- **Residual risk:** object deletion via the Storage API is best-effort per call; the purge sweep provides the backstop, so worst case is delayed deletion, never extended availability through the app (access checks gate independently).

### 3.17 Downloaded file persistence
- **Scenario:** a recipient saves the decrypted file locally; the creator later revokes everything.
- **Mitigation:** nothing — this is explicitly outside the model. Server-side destruction is total, but bytes already saved to a remote device cannot be recalled by any delivery system.
- **Evidence:** documented limitation in README §Limitations and technical-overview §24.
- **Residual risk:** accepted. Guidance: send files only to recipients you trust with their own copy; prefer burn-after-read to minimize re-obtaining windows.

## 4. Explicit Non-Goals

- Recalling content already rendered or saved on a recipient's device.
- Defending against compromised browsers/devices of any participant.
- Defending against malicious served client code (§3.12).
- Protection from lawful compulsion of metadata (the operator holds it).
- Cryptographic non-repudiation: audit logs are **auditable access events** supporting operational review — they are not tamper-proof evidence and make no legal claims.

## 5. Testing Evidence

**126/126 automated scenarios pass** across seven suites, executed against the live Supabase project:

| Suite | Result | Security-relevant coverage |
|---|---|---|
| Legacy | 4/4 | Single-recipient compatibility incl. optimistic-CAS consumption |
| Multi-recipient | 24/24 | Independent copies, per-recipient revocation/isolation |
| Time-lock | 9/9 | 423 before release, release-at behavior, validation rules |
| Lockout | 5/5 | Failure countdown, destruction at 5 |
| Dead man's switch | 10/10 | Renewal, deadline expiry, self-destruction |
| Security hardening | 31/31 | 20-way open race (one winner), 12-way wrong-PIN race (all counted), revoked/expired denial, max-view enforcement, plaintext-leak scans of every response |
| File delivery | 43/43 | Byte-exact round-trips (PDF/PNG/random), wrong-PIN unwrap rejection, 413/415 limits, blob deletion across burn/expiry/revoke/lockout, 6-way race, private-bucket anonymous-access probes, text regression |

Type-check passes; ESLint reports 0 errors (1 pre-existing config warning). All randomness derives from Web Crypto (`crypto.getRandomValues` / `crypto.subtle`). Atomic-consumption behavior was additionally verified under load against production-style data paths (concurrent winners, replay denials, structured 404s). Measured performance benchmarks and an accessibility audit (43/43 checks, targeted WCAG 2.1 AA spot-checks) are documented in [`technical-overview.md`](technical-overview.md) §21.

## 6. Summary of Honest Limitations

1. Recipients who legitimately decrypt content can copy, screenshot, or save it.
2. Downloaded files cannot be remotely destroyed.
3. Compromised participant devices defeat the model at the endpoints.
4. Malicious served JavaScript defeats browser-crypto systems entirely (acknowledged, out of scope).
5. Weak PINs are brute-forceable offline where ciphertext survives; destruction defaults exist to shrink that window.
6. The server sees metadata (titles, filenames/sizes/MIME types, policies, hashed IPs, event timelines) even though it cannot access plaintext content or decryption keys under the documented model.
