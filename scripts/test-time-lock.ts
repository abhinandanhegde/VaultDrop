import { encryptSecret, generatePIN } from "../src/lib/crypto.ts";

const BASE = process.env.BASE_URL || "http://localhost:3000";
let passed = 0, failed = 0;
function ok(c: boolean, l: string, e?: unknown) {
  if (c) { passed++; console.log(`  PASS  ${l}`); }
  else { failed++; console.log(`  FAIL  ${l}${e !== undefined ? " -> " + JSON.stringify(e) : ""}`); }
}
async function req(p: string, init?: RequestInit) {
  const res = await fetch(BASE + p, init);
  let b: any = null; try { b = await res.json(); } catch {}
  return { status: res.status, body: b };
}

const secret = "TIME_LOCKED_SECRET_" + Date.now();
const pin = generatePIN();
const e = await encryptSecret(secret, pin);

const now = Date.now();
const releaseInMs = 8000;               // unlock 8s after create
const releaseAt = new Date(now + releaseInMs).toISOString();

function sameTime(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 5000;
}

// 1. Create with a future releaseAt
const create = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations,
    pin, maxViews: 1, expiresAt: null, releaseAt, burnAfterReading: true, title: "time-lock-test",
  }),
});
ok(create.status === 200 && create.body.status === "ok", "create with releaseAt ok", create.body);
const id = create.body.id;
const recipientToken = create.body.recipients?.[0]?.urlToken;

// 2. Before release: legacy metadata reports active
const metaBefore = await req(`/api/delivery/${id}`);
ok(metaBefore.status === 200 && metaBefore.body.data.status === "active", "legacy meta still active", metaBefore.body);

// 3. Before release: legacy access blocked with 423 + releaseAt
const accessBefore = await req(`/api/delivery/${id}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(accessBefore.status === 423 && sameTime(accessBefore.body.releaseAt, releaseAt), "legacy access blocked before release (423 + releaseAt)", accessBefore.body);

// 4. Before release: recipient link reads not_released with releaseAt
const recMeta = await req(`/api/recipients/${recipientToken}`);
ok(recMeta.status === 200 && recMeta.body.data.state === "not_released" && sameTime(recMeta.body.data.releaseAt, releaseAt), "recipient link state=not_released + releaseAt", recMeta.body);

// 5. Before release: recipient access blocked (423 + releaseAt)
const recAccess = await req(`/api/recipients/${recipientToken}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(recAccess.status === 423 && sameTime(recAccess.body.releaseAt, releaseAt), "recipient access blocked before release", recAccess.body);

// 6. Validation: releaseAt in the past is rejected
const pastCreate = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations,
    pin, maxViews: 1, expiresAt: null, releaseAt: new Date(now - 1000).toISOString(), burnAfterReading: true, title: "past-release",
  }),
});
ok(pastCreate.status === 400, "releaseAt in the past rejected", pastCreate.body);

// 7. Validation: expiresAt before releaseAt rejected
const badExpiry = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations,
    pin, maxViews: 1, expiresAt: new Date(now + 1000).toISOString(), releaseAt: new Date(now + 60000).toISOString(), burnAfterReading: true, title: "expiry-before-release",
  }),
});
ok(badExpiry.status === 400, "expiry before release rejected", badExpiry.body);

// 8. After release time passes, access works
await new Promise((r) => setTimeout(r, releaseInMs + 1500));

// Recipient access first (legacy access burns the whole delivery, which would block this)
const recAccessAfter = await req(`/api/recipients/${recipientToken}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(recAccessAfter.status === 200 && recAccessAfter.body.status === "ok", "recipient access allowed after release", recAccessAfter.body);

const accessAfter = await req(`/api/delivery/${id}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(accessAfter.status === 200 && accessAfter.body.status === "ok", "legacy access allowed after release", accessAfter.body);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);