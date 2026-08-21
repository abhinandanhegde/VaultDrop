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

const secret = "LEGACY_FLOW_STILL_WORKS_" + Date.now();
const pin = generatePIN();
const e = await encryptSecret(secret, pin);
const create = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations, pin, maxViews: 1, expiresAt: null, burnAfterReading: true, title: "legacy-single" }),
});
ok(create.status === 200 && create.body.status === "ok", "legacy single-recipient create ok", create.body);
const id = create.body.id;

const meta = await req(`/api/delivery/${id}`);
ok(meta.status === 200 && meta.body.data.status === "active", "legacy /d metadata ok", meta.body);

const access = await req(`/api/delivery/${id}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(access.status === 200 && access.body.status === "ok", "legacy /d access ok", access.body);

const again = await req(`/api/delivery/${id}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(again.status === 410, "legacy /d burned after read -> 410", again.status);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);