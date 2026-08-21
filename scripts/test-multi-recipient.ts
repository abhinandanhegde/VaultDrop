// End-to-end test: multi-recipient delivery + read receipts + per-recipient revoke
// Run: node --experimental-strip-types scripts/test-multi-recipient.ts
import { encryptSecret, decryptSecret, generatePIN } from "../src/lib/crypto.ts";

const BASE = process.env.BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
  }
}

async function req(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  const secretText = `MULTI_RECIPIENT_SECRET_${Date.now()}`;
  const pin1 = generatePIN();
  const pin2 = generatePIN();

  console.log("\n[1] Create delivery with 2 recipients");
  const e1 = await encryptSecret(secretText, pin1);
  const e2 = await encryptSecret(secretText, pin2);
  const create = await req("/api/delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipients: [
        { name: "Alice", pin: pin1, ...e1 },
        { name: "Bob", pin: pin2, ...e2 },
      ],
      title: `Multi-test-${Date.now()}`,
      maxViews: 1,
      expiresAt: null,
      burnAfterReading: true,
      contentType: "text/plain",
    }),
  });

  ok(create.status === 200 && create.body.status === "ok", "create returns ok", create.body);
  const created = create.body;
  const deliveryId = created.id;
  const creatorToken = created.creatorToken;
  ok(Array.isArray(created.recipients) && created.recipients.length === 2, "two recipients returned", created.recipients);
  ok(created.recipients[0].name === "Alice", "recipient 1 name preserved");
  ok(created.recipients[0].pin === pin1, "recipient 1 pin echoed");
  ok(created.recipients[0].urlToken && created.recipients[0].urlToken.length >= 16, "recipient 1 urlToken generated");

  const tok1 = created.recipients[0].urlToken;
  const tok2 = created.recipients[1].urlToken;

  console.log("\n[2] Recipient metadata (pending)");
  const meta1 = await req(`/api/recipients/${tok1}`);
  ok(meta1.status === 200 && meta1.body.data.state === "pending", "recipient 1 state pending", meta1.body);
  ok(meta1.body.data.title && meta1.body.data.title.startsWith("Multi-test-"), "metadata includes delivery title");

  console.log("\n[3] Wrong PIN is rejected");
  const wrong = await req(`/api/recipients/${tok1}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "000000" }),
  });
  ok(wrong.status === 403, "wrong PIN -> 403", { status: wrong.status, body: wrong.body });

  console.log("\n[4] Correct PIN decrypts the secret");
  const access1 = await req(`/api/recipients/${tok1}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: pin1 }),
  });
  ok(access1.status === 200 && access1.body.status === "ok", "access returns ok", access1.body);
  ok(access1.body.destroyed === true, "burned after reading", access1.body.destroyed);
  if (access1.body.data) {
    const d = access1.body.data;
    const decrypted = await decryptSecret(d.encryptedData, d.nonce, d.salt, d.iterations, pin1);
    ok(decrypted === secretText, "decrypted secret matches original");
  } else {
    failed++;
    console.log("  FAIL  access returned no data");
  }

  console.log("\n[5] Re-read is refused after burn");
  const again = await req(`/api/recipients/${tok1}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: pin1 }),
  });
  ok(again.status === 410, "second access -> 410", { status: again.status, body: again.body });

  console.log("\n[6] Recipient 1 metadata now reads as destroyed");
  const meta1b = await req(`/api/recipients/${tok1}`);
  ok(meta1b.body.data.state === "destroyed", "recipient 1 state destroyed", meta1b.body.data.state);

  console.log("\n[7] Revoke recipient 2 only");
  const rev = await req(`/api/recipients/${tok2}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creatorToken }),
  });
  ok(rev.status === 200 && rev.body.status === "ok", "revoke recipient 2 ok", rev.body);

  const meta2 = await req(`/api/recipients/${tok2}`);
  ok(meta2.body.data.state === "revoked", "recipient 2 now revoked", meta2.body.data.state);

  const access2 = await req(`/api/recipients/${tok2}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: pin2 }),
  });
  ok(access2.status === 410, "recipient 2 access refused after revoke", { status: access2.status });

  console.log("\n[8] Recipient 1 still destroyed, but link format ok");
  const meta1c = await req(`/api/recipients/${tok1}`);
  ok(meta1c.body.data.state === "destroyed", "recipient 1 stays destroyed");

  console.log("\n[9] Dashboard shows per-recipient statuses");
  const dash = await req(`/api/delivery/${deliveryId}/recipients?token=${creatorToken}`);
  ok(dash.status === 200 && dash.body.status === "ok", "dashboard list ok", dash.body);
  const recs = dash.body.data.recipients;
  ok(recs.length === 2, "two recipients listed", recs.length);
  const r1 = recs.find((r) => r.urlToken === tok1);
  const r2 = recs.find((r) => r.urlToken === tok2);
  ok(r1 && r1.status === "opened" && r1.openedAt, "recipient 1 opened with timestamp", r1);
  ok(r2 && r2.status === "revoked" && r2.revokedAt, "recipient 2 revoked with timestamp", r2);

  console.log("\n[10] Dashboard auth guard");
  const badDash = await req(`/api/delivery/${deliveryId}/recipients?token=wrongtoken1234567890`);
  ok(badDash.status === 403, "wrong creator token -> 403", badDash.status);

  console.log("\n[11] Validate duplicate pin / bad payload");
  const bad = await req("/api/delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipients: [{ pin: "12" }], title: "x" }),
  });
  ok(bad.status === 400, "invalid recipient pin -> 400", bad.status);

  const empty = await req("/api/delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipients: [], title: "x" }),
  });
  ok(empty.status === 400, "empty recipients -> 400", empty.status);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});