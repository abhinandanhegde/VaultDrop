# VaultDrop — Technical Overview

> A privacy-first platform for controlled information sharing with policy-driven access and lifecycle management.

## 1. Overview

VaultDrop treats shared content — a text secret or an uploaded file — not as static data but as a **controlled delivery** governed by explicit conditions:

- **Who** can access it
- **How** access is authenticated
- **When** it becomes available
- **How many times** it can be accessed
- **When** it expires, is revoked, or destroyed

It combines client-side encryption, recipient-specific access, authenticated delivery, lifecycle enforcement, and audit events into a single workflow.

## 2. Design Principles

| Principle | Meaning |
|---|---|
| **Privacy by Design** | Content is encrypted on the client before submission to the backend. |
| **Controlled Access** | Every delivery defines its own authentication and access policy. |
| **Limited Exposure** | View limits, expiration, burn-after-reading, and revocation reduce exposure time. |
| **Explicit Lifecycle Management** | A delivery has a defined state machine rather than remaining permanently available. |

## 3. Core Workflow

```text
Create → Encrypt → Configure Policy → Deliver → Authenticate → Access → Expire / Revoke / Destroy
```

## 4. Delivery Model

A **delivery** is the central domain object. Each delivery may contain:

| Field Group | Contents |
|---|---|
| Payload | Encrypted payload (`text` secret or `file` ciphertext) + cryptographic parameters; file deliveries additionally reference an encrypted Storage blob |
| Authentication | PIN configuration |
| Recipients | Per-recipient access configuration |
| Policy | Max view count, expiration, release time, burn-after-reading |
| State | Lifecycle status, creation/access timestamps |

This lets security and lifecycle policies be defined independently per delivery.

## 5. Client-Side Encryption

Content is encrypted **before transmission**, using:

- AES-256-GCM (authenticated encryption)
- PBKDF2 key derivation with configurable iteration count
- Per-delivery salt + unique GCM nonce

The database stores only ciphertext and cryptographic parameters — never plaintext. Security claims are validated against the implementation and deployment configuration, not assumed from the schema alone.

File deliveries use **envelope encryption** on top of the same primitives: the browser generates a fresh random 256-bit content key that encrypts the file once (AES-256-GCM), then wraps that content key once per recipient with the same PBKDF2-derived-key construction used for text secrets. Each recipient unwraps their copy of the key locally after PIN validation. The raw content key never leaves the creator's browser, and the server handles ciphertext only — stored as opaque `application/octet-stream` objects in a private Storage bucket under randomized paths, so even object paths reveal nothing about the original filename.

## 6. Recipient-Specific Access

Each recipient receives an independent access mechanism, so the creator controls access per recipient instead of relying on a single shared link. Recipient access can be revoked individually where supported by policy.

```text
Delivery
├── Recipient A → Access
├── Recipient B → Access
└── Recipient C → Revoked
```

## 7. Authentication and Protection

Protected deliveries can require PIN-based authentication, with:

- PIN verification (bcrypt hash stored — never plaintext)
- Failed-attempt tracking and lockout behavior
- Rate limiting
- Recipient-specific access tokens + creator authorization tokens

## 8. Time-Locked Release

A delivery can be configured with a future release time:

```text
Locked → Release time reached → Authentication → Access
```

Time-lock is enforced in the server-side access flow, never by frontend state alone.

## 9. Lifecycle Controls

| Control | Effect |
|---|---|
| **Expiration** | Automatically unavailable after configured expiry time |
| **Burn After Reading** | Unavailable after its permitted access |
| **Revocation** | Creator recalls an active delivery |
| **Recipient Revocation** | Individual recipient access revoked independently |
| **Destruction** | Encrypted payload removed from the active record; encrypted file blobs deleted from Storage |

## 10. Dead-Man's Switch

A configurable mechanism allowing a delivery to respond to the *absence* of an expected creator action. This extends lifecycle control beyond fixed expiration times to condition-based self-destruction.

## 11. Delivery State Model

States: `active` · `accessed` · `expired` · `revoked` · `locked` · `destroyed`

```text
              ┌──────────┐
              │  ACTIVE  │
              └────┬─────┘
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
     ACCESSED   REVOKED    EXPIRED
        │          │          │
        └──────────┼──────────┘
                   ↓
               DESTROYED
```

## 12. Audit and Lifecycle Events

A dedicated event model records lifecycle activity without ever including plaintext content:

`created` · `pin_validated` · `pin_failed` · `accessed` · `expired` · `revoked` · `locked` · `destroyed`

## 13. Database Architecture

PostgreSQL via Supabase, primary tables:

| Table | Stores | Notes |
|---|---|---|
| `deliveries` | ID, encrypted payload, crypto parameters, PIN scheme/hash, access policy, lifecycle status, metadata, timestamps | File deliveries add `kind`, file name/MIME/size, `storage_path`, `file_nonce`, and `enc_version`; indexed on commonly accessed fields |
| `recipients` | Per-recipient encrypted copies: wrapped key material, URL token, PIN hash, view count, lockout state | One row per recipient; independent consumption and revocation |
| `access_events` | Event ID, delivery reference, event type, timestamp, metadata | Indexed likewise |

Encrypted file payloads live outside PostgreSQL in a **private** Supabase Storage bucket
(`vaultdrop-files`) that stores only `application/octet-stream` ciphertext objects at
randomized paths. The bucket is reachable exclusively through service-role credentials held
by server-side routes — no public URLs, no anon-key policies.

Row Level Security is enabled on protected tables.

## 14. Atomic Operations

Concurrent requests must not corrupt security-sensitive state transitions or view counts — e.g. with `max views = 1`, two simultaneous requests must never both consume the one-time allowance. Dedicated database operations handle these transitions atomically.

## 15. Application Architecture

Next.js + TypeScript application:

```text
Application Layer
├── Pages / UI
├── React Components
├── API Routes
└── Security / Utility Modules

Backend Flow
Client → Next.js API Route → Validation / Authorization → Supabase → PostgreSQL
```

API routes handle delivery creation, access, recipient management, lifecycle operations, and event retrieval.

## 16. Security Components

Dedicated modules isolate security-sensitive logic from presentation-layer components (reducing coupling, easing audit/test):

Cryptographic operations · Password/PIN hashing · Rate limiting · Dead-man's-switch logic · Supabase server access · Delivery lifecycle operations

## 17. Testing and Reliability

Targeted test scripts cover:

Legacy behavior · Multi-recipient access · Time-locked release · Lockout self-destruct · Dead-man's-switch behavior · Security hardening (concurrency races, lockout, plaintext-leak scans) · Encrypted file delivery (round trips, size/type limits, lifecycle blob deletion, private-bucket denial)

Current status: **125 of 126 automated scenarios pass**; the sole failure is a stale test
expectation documented in the threat model (§8).

Security testing validates that policies are enforced at the **application and database boundaries**, not solely via frontend restrictions.

## 18. Technology Stack

| Layer | Technologies |
|---|---|
| Application | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Next.js API Routes, Supabase (PostgreSQL + Storage), Vercel |
| Security | AES-256-GCM, PBKDF2, bcrypt, Envelope Encryption (files), Row Level Security, Rate Limiting |
| Deployment | Vercel, Supabase |

## 19. Engineering Objectives

VaultDrop demonstrates:

- Secure client-side data handling
- Explicit access-policy enforcement and recipient-specific authorization
- Time- and condition-based availability
- Controlled secret lifecycle management
- Atomic handling of security-sensitive operations
- Auditable delivery state transitions

The architecture is intentionally centered around the **delivery lifecycle** — not paste-and-delete.
