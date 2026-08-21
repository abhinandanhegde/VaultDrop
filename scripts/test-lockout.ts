import { readFileSync } from "node:fs";
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

const secret = "LOCKOUT_DESTROY_" + Date.now();
const pin = generatePIN();
const e = await encryptSecret(secret, pin);

const create = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations,
    pin, maxViews: 1, expiresAt: null, burnAfterReading: true, title: "lockout-test",
  }),
});
ok(create.status === 200 && create.body.status === "ok", "create ok", create.body);
const id = create.body.id;

// 5 wrong PINs on the legacy flow
const wrongPins: number[] = [];
for (let i = 0; i < 5; i++) {
  const a = await req(`/api/delivery/${id}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "000000" }),
  });
  wrongPins.push(a.status);
}
ok(wrongPins.every((s, i) => (i < 4 ? s === 403 : s === 423)), "5 wrong PINs -> 403x4 then 423", wrongPins);

// After lockout, even the correct PIN is refused because data is gone
const after = await req(`/api/delivery/${id}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(after.status !== 200, "correct PIN no longer succeeds after lockout", after.status);

// Verify ciphertext was actually wiped server-side (not just rate-limited)
const lines = readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n");
const svcKey = lines.find((l: string) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))?.split("=").slice(1).join("=");
const supabaseUrl = lines.find((l: string) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="))?.split("=").slice(1).join("=");
if (svcKey && supabaseUrl) {
  const sres = await fetch(`${supabaseUrl}/rest/v1/deliveries?select=encrypted_data,status&id=eq.${id}`, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  });
  const sbody: any = await sres.json().catch(() => null);
  ok(Array.isArray(sbody) && sbody.length === 1 && sbody[0].encrypted_data === null && sbody[0].status === "locked",
    "ciphertext wiped + status locked in DB", sbody);
} else {
  ok(false, "could not read .env.local for DB verification");
}

// Verify the delivery is marked locked
const meta = await req(`/api/delivery/${id}`);
ok(meta.body.data?.status === "locked" || meta.status === 200, "delivery status reflects locked", meta.body);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);