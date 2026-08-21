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

const secret = "DEADMAN_SECRET_" + Date.now();
const pin = generatePIN();
const e = await encryptSecret(secret, pin);

const windowMin = 1;                          // self-destruct 1 minute from create
const renewalWindowMinutes = windowMin;

// 1. Create with a renewal deadline
const create = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e.encryptedData, nonce: e.nonce, salt: e.salt, iterations: e.iterations,
    pin, maxViews: 1, expiresAt: null, burnAfterReading: true, title: "deadman-test",
    renewalWindowMinutes,
  }),
});
ok(create.status === 200 && create.body.status === "ok", "create with renewal window ok", create.body);
const id = create.body.id;
const creatorToken = create.body.creatorToken;
const recipientToken = create.body.recipients?.[0]?.urlToken;

// 2. Status reports renewalDeadline set + ~1 minute out
const st = await req(`/api/delivery/${id}/status?token=${creatorToken}`);
const dl = st.body?.data?.renewalDeadline;
ok(
  st.status === 200 && !!dl &&
    new Date(dl).getTime() - Date.now() > 30_000 &&
    new Date(dl).getTime() - Date.now() < 90_000,
  "status has renewalDeadline ~1 min out",
  st.body,
);

// 3. Renew pushes the deadline forward (before expiry)
const renewBefore = await req(`/api/delivery/${id}/renew`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ creatorToken }),
});
ok(renewBefore.status === 200 && renewBefore.body.status === "ok" && !!renewBefore.body.renewalDeadline, "renew ok before expiry", renewBefore.body);

// 4. Access still works right after renew (PIN valid, not self-destructed)
const accessAfterRenew = await req(`/api/recipients/${recipientToken}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(accessAfterRenew.status === 200 && accessAfterRenew.body.status === "ok", "access still ok after renew", accessAfterRenew.body);

// 5. Renewal with wrong creator token rejected
const renewWrong = await req(`/api/delivery/${id}/renew`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ creatorToken: "bogus" }),
});
ok(renewWrong.status === 403, "renew with wrong creator token rejected", renewWrong.body);

// 6. Backdate the renewal deadline on a fresh drop via Supabase, then verify the
//    drop self-destructs on access (ciphertext wiped + status destroyed).
import { readFileSync } from "node:fs";
const envLines = readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n");
const env: Record<string, string> = {};
for (const line of envLines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const e2 = await encryptSecret("DEADMAN_EXPIRE_" + Date.now(), pin);
const create2 = await req("/api/delivery", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedData: e2.encryptedData, nonce: e2.nonce, salt: e2.salt, iterations: e2.iterations,
    pin, maxViews: 1, expiresAt: null, burnAfterReading: true, title: "deadman-expire",
    renewalWindowMinutes: 1,
  }),
});
ok(create2.status === 200 && create2.body.status === "ok", "create second (expiring) drop ok", create2.body);
const id2 = create2.body.id;
const token2 = create2.body.recipients?.[0]?.urlToken;

// Backdate the deadline so the switch triggers
const backdate = await fetch(`${SB_URL}/rest/v1/deliveries?id=eq.${id2}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    Prefer: "return=minimal",
  },
  body: JSON.stringify({ renewal_deadline: new Date(Date.now() - 5000).toISOString() }),
});
ok(backdate.ok, "backdated renewal deadline via Supabase", backdate.status);

// Recipient meta now reports destroyed (self-destructed)
const recMeta = await req(`/api/recipients/${token2}`);
ok(
  recMeta.status === 200 && recMeta.body.data.state === "deadman",
  "recipient meta reports deadman after missed renewal",
  recMeta.body,
);

// Recipient access returns 410 self-destructed
const recAccess = await req(`/api/recipients/${token2}/access`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin }),
});
ok(recAccess.status === 410, "recipient access blocked (410) after self-destruct", recAccess.body);

// Verify DB: status destroyed + ciphertext wiped
const check = await fetch(`${SB_URL}/rest/v1/deliveries?select=status,encrypted_data,renewal_deadline&id=eq.${id2}`, {
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
});
const rows = await check.json();
const row = rows?.[0];
ok(
  row && row.status === "destroyed" && row.encrypted_data === null && row.renewal_deadline === null,
  "DB: status=destroyed, ciphertext + deadline wiped",
  row,
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);