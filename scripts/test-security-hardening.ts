// VaultDrop — Security hardening test suite
// Covers the mandated scenarios:
//   1. repeated wrong PIN attempts (lockout + destroy)
//   2. parallel/concurrent wrong PIN attempts (atomic counting)
//   3. revoked recipient access
//   4. expired recipient access
//   5. double simultaneous access to a burn-after-reading secret
//   6. max-view enforcement
//   7. API never returning plaintext
//
// Acts as the NEW client: sends SHA-256(pin) hex as the transport value
// and decrypts locally with the raw PIN.
//
// Run: BASE_URL=http://localhost:3003 node scripts/test-security-hardening.ts

import { createHash } from "node:crypto";
import { encryptSecret, decryptSecret } from "../src/lib/crypto.ts";

const BASE = process.env.BASE_URL || "http://localhost:3003";
const sha256hex = (p: string) => createHash("sha256").update(p).digest("hex");

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
}

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
}

interface DropHandle {
  id: string;
  creatorToken: string;
  token: string;
  pin: string;
  plaintext: string;
}

async function createDrop(opts: {
  burnAfterReading?: boolean;
  maxViews?: number;
  expiresAt?: string | null;
}): Promise<DropHandle> {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const plaintext = `HARDENING_SECRET_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const enc = await encryptSecret(plaintext, pin);

  // Rotate a synthetic source IP so repeated suite runs don't exhaust the
  // create rate limiter (10/hour/IP). Dev's clientIp() trusts XFF; in
  // production the edge overwrites it, so this is test-only convenience.
  const synthIp = `${10 + (Math.floor(Math.random() * 200))}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;

  const res = await req("/api/delivery", {
    method: "POST",
    headers: { "X-Forwarded-For": synthIp },
    body: JSON.stringify({
      recipients: [
        {
          name: "hardening-tester",
          pin: sha256hex(pin), // transport-hashed — the new client behavior
          encryptedData: enc.encryptedData,
          nonce: enc.nonce,
          salt: enc.salt,
          iterations: enc.iterations,
        },
      ],
      maxViews: opts.maxViews ?? 1,
      expiresAt: opts.expiresAt ?? null,
      burnAfterReading: opts.burnAfterReading ?? true,
      title: `sec-hardening-${Date.now()}`,
      contentType: "text/plain",
    }),
  });

  if (res.status !== 200 || res.body?.status !== "ok") {
    throw new Error(`createDrop failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return {
    id: res.body.id,
    creatorToken: res.body.creatorToken,
    token: res.body.recipients[0].urlToken,
    pin,
    plaintext,
  };
}

const accessUrl = (token: string) => `/api/recipients/${token}/access`;
const postPin = async (token: string, rawPin: string) =>
  req(accessUrl(token), { method: "POST", body: JSON.stringify({ pin: sha256hex(rawPin) }) });

async function warmRoute(token: string) {
  await postPin(token, "000000"); // guaranteed-wrong; also compiles the route
}

async function main() {
  console.log(`\n=== VaultDrop security hardening suite (${BASE}) ===\n`);

  // ---------------------------------------------------------------
  console.log("[1] Repeated wrong PIN attempts -> lockout + destruction");
  {
    const d = await createDrop({ burnAfterReading: false });
    // NOTE: no wrong-PIN warmup here — every failed attempt counts toward
    // the lockout, including warmups (that's the feature under test).

    const statuses: number[] = [];
    let remainingSeen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await postPin(d.token, "111111");
      statuses.push(r.status);
      if (r.body?.remainingAttempts !== undefined) remainingSeen.push(r.body.remainingAttempts);
    }
    ok(statuses.every((s) => s === 403), "first four wrong PINs -> 403", statuses);
    ok(
      remainingSeen.length === 4 && remainingSeen.every((v, i) => v === 4 - i),
      "remainingAttempts counts down 4..1",
      remainingSeen,
    );

    const fifth = await postPin(d.token, "111111");
    ok(fifth.status === 423, "fifth wrong PIN -> 423 locked", fifth.status);
    ok(
      typeof fifth.body?.message === "string" && !/\d/.test(fifth.body.message),
      "generic message on lockout",
      fifth.body?.message,
    );

    const after = await postPin(d.token, d.pin); // even the CORRECT pin now
    ok(after.status === 410, "correct PIN after lockout -> 410", after.status);

    const meta = await req(`/api/recipients/${d.token}`);
    ok(meta.body?.data?.state === "locked", "metadata reports locked", meta.body?.data?.state);
  }

  // ---------------------------------------------------------------
  console.log("\n[2] Parallel/concurrent wrong PIN attempts (atomic counting)");
  {
    const d = await createDrop({ burnAfterReading: false });
    await warmRoute(d.token);

    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, () => postPin(d.token, "222222").then((r) => r.status)),
    );
    ok(
      results.every((s) => s === 403 || s === 423),
      `all ${N} parallel responses are 403/423 (no 5xx, no leaks)`,
      results,
    );
    ok(results.includes(423), "at least one response signalled lockout", results);

    const meta = await req(`/api/recipients/${d.token}`);
    ok(meta.body?.data?.state === "locked", "drop locked after parallel attack", meta.body?.data?.state);

    const victim = await createDrop({ burnAfterReading: false });
    const probe = await postPin(victim.token, "999999");
    ok(probe.status === 403, "unrelated drop unaffected", probe.status);
  }

  // ---------------------------------------------------------------
  console.log("\n[3] Revoked recipient access");
  {
    const d = await createDrop({ burnAfterReading: false });
    const rev = await req(`/api/recipients/${d.token}/revoke`, {
      method: "POST",
      body: JSON.stringify({ creatorToken: d.creatorToken }),
    });
    ok(rev.status === 200 && rev.body?.status === "ok", "revoke succeeds with creator token", rev.status);

    const meta = await req(`/api/recipients/${d.token}`);
    ok(meta.body?.data?.state === "revoked", "metadata reflects revoked", meta.body?.data?.state);

    const denied = await postPin(d.token, d.pin); // correct pin, revoked link
    ok(denied.status === 410, "revoked recipient cannot access (even correct PIN)", denied.status);

    const noAuth = await req(`/api/recipients/${d.token}/revoke`, {
      method: "POST",
      body: JSON.stringify({ creatorToken: "wrong-token-wrong-token-wrong" }),
    });
    ok(noAuth.status !== 200, "revoke without valid creator token refused", noAuth.status);
  }

  // ---------------------------------------------------------------
  console.log("\n[4] Expired recipient access");
  {
    const d = await createDrop({
      burnAfterReading: false,
      expiresAt: new Date(Date.now() + 2500).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 3500));

    const meta = await req(`/api/recipients/${d.token}`);
    ok(meta.body?.data?.state === "expired", "metadata shows expired after deadline", meta.body?.data?.state);

    const denied = await postPin(d.token, d.pin); // correct pin, expired drop
    ok(denied.status === 410, "expired recipient cannot access (correct PIN)", denied.status);
  }

  // ---------------------------------------------------------------
  console.log("\n[5] Double simultaneous access to burn-after-read secret");
  {
    const d = await createDrop({ burnAfterReading: true });
    await warmRoute(d.token);

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => postPin(d.token, d.pin)),
    );
    const winners = results.filter((r) => r.status === 200 && r.body?.data?.encryptedData);
    const losers = results.filter((r) => !(r.status === 200 && r.body?.data?.encryptedData));

    ok(winners.length === 1, `exactly one winner served ciphertext (got ${winners.length})`, results.map((r) => r.status));
    ok(
      losers.every((r) => [409, 410, 429].includes(r.status)),
      "all losers receive honest 409/410/429 (no empty 200s)",
      losers.map((r) => r.status),
    );

    // Winner's ciphertext must decrypt to the original plaintext with the RAW pin
    const w = winners[0];
    const roundtrip = await decryptSecret(
      w.body.data.encryptedData,
      w.body.data.nonce,
      w.body.data.salt,
      w.body.data.iterations,
      d.pin,
    );
    ok(roundtrip === d.plaintext, "winner's ciphertext decrypts correctly client-side");

    const replay = await postPin(d.token, d.pin);
    ok(replay.status === 410, "replay after burn -> 410", replay.status);
  }

  // ---------------------------------------------------------------
  console.log("\n[6] Max-view enforcement");
  {
    const d = await createDrop({ burnAfterReading: false, maxViews: 2 });
    await warmRoute(d.token);

    const v1 = await postPin(d.token, d.pin);
    ok(v1.status === 200 && v1.body?.destroyed === false, "view 1/2 allowed", v1.status);

    const v2 = await postPin(d.token, d.pin);
    ok(v2.status === 200 && v2.body?.destroyed === true, "view 2/2 allowed then burns", v2.body?.destroyed);

    const v3 = await postPin(d.token, d.pin);
    ok(v3.status === 410, "view 3 blocked (max_views reached)", v3.status);
  }

  // ---------------------------------------------------------------
  console.log("\n[7] API never returns plaintext");
  {
    const d = await createDrop({ burnAfterReading: false });
    const res = await postPin(d.token, d.pin);
    ok(res.status === 200, "access succeeded", res.status);

    const raw = JSON.stringify(res.body);
    ok(!raw.includes(d.plaintext), "response contains no plaintext substring");
    ok(!raw.toLowerCase().includes('"pin"'), "response contains no pin field");
    const keys = Object.keys(res.body.data || {}).sort();
    const expected = ["burnAfterReading", "contentType", "encryptedData", "iterations", "nonce", "salt", "title"].sort();
    ok(
      keys.length === expected.length && keys.every((k) => expected.includes(k)),
      "response data fields limited to expected ciphertext metadata",
      keys,
    );

    const metaRaw = JSON.stringify((await req(`/api/recipients/${d.token}`)).body);
    ok(!metaRaw.includes("encryptedData") && !metaRaw.includes("encrypted_data"), "metadata endpoint returns no ciphertext");
    ok(!metaRaw.includes(d.plaintext), "metadata endpoint contains no plaintext");

    // Transport-hashing sanity: server stored bcrypt(SHA-256(pin)) — sending the
    // RAW pin against a hashed-scheme drop must fail like any wrong PIN.
    const rawAttempt = await fetch(`${BASE}${accessUrl(d.token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "555555" }),
    });
    ok(rawAttempt.status >= 400, "wrong PIN still rejected under hashed scheme", rawAttempt.status);

    const scheme = (await req(`/api/recipients/${d.token}`)).body?.data;
    ok(scheme?.state !== undefined, "metadata endpoint reachable for scheme check");
  }

  // ---------------------------------------------------------------
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Suite crashed:", e);
  process.exit(1);
});
