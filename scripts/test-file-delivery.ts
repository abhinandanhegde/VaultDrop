// VaultDrop — Encrypted file delivery security suite
// Covers:
//   - file key wrap/unwrap + byte encryption round trips (PDF/image/random)
//   - creation, metadata exposure, randomized storage paths
//   - PIN validation, brute-force lockout on file drops
//   - expiration, revocation, max views, burn-after-read (blob deletion)
//   - concurrent access race
//   - oversized + unsupported-type rejection
//   - private bucket enforcement, ciphertext-only storage
//   - plaintext absence in API responses
//   - text-secret flow regression
//
// Run: BASE_URL=http://localhost:3003 node scripts/test-file-delivery.ts

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  generateFileKey,
  encryptBytesWithRawKey,
  decryptBytesWithRawKey,
  wrapFileKeyForRecipient,
  unwrapFileKeyWithPin,
} from "../src/lib/crypto.ts";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL || "http://localhost:3003";
const sha256hex = (p: string) => createHash("sha256").update(p).digest("hex");

// ---- Service client for storage/DB assertions (values never printed) ------
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env.local optional */
  }
  return out;
}
const ENV = loadEnv();
const SB_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SERVICE) {
  console.error("FATAL: Supabase env vars missing (need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
}

function synthIp() {
  return `${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
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

interface FileDrop {
  id: string;
  creatorToken: string;
  token: string;
  pin: string;
  plain: Uint8Array;
  fileName: string;
}

async function createFileDrop(opts: {
  fileName?: string;
  mime?: string;
  bytes?: Uint8Array;
  maxViews?: number;
  burnAfterReading?: boolean;
  expiresAt?: string | null;
}): Promise<FileDrop> {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const fileName = opts.fileName ?? `topsecret-report-${Date.now()}.pdf`;
  const plain =
    opts.bytes ??
    Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(2048, 0x41),
      Buffer.from(`MARKER_${Date.now()}_${Math.random().toString(36).slice(2)}\n%%EOF`),
    ]);

  const dek = generateFileKey();
  const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(plain, dek);
  const wrapped = await wrapFileKeyForRecipient(dek, pin);
  dek.fill(0);

  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      recipients: [{ name: "file-tester", pin: sha256hex(pin), wrapped }],
      maxViews: opts.maxViews ?? 1,
      expiresAt: opts.expiresAt ?? null,
      burnAfterReading: opts.burnAfterReading ?? true,
      title: `file-test-${Date.now()}`,
      fileName,
      fileMime: opts.mime ?? "application/pdf",
      fileNonce: nonceB64,
    }),
  );
  form.append("file", new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" }), "encrypted.bin");

  const res = await fetch(`${BASE}/api/delivery/file`, {
    method: "POST",
    headers: { "X-Forwarded-For": synthIp() },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || body?.status !== "ok") {
    throw new Error(`createFileDrop failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return {
    id: body.id,
    creatorToken: body.creatorToken,
    token: body.recipients[0].urlToken,
    pin,
    plain: new Uint8Array(plain),
    fileName,
  };
}

async function access(token: string, rawPin: string) {
  const res = await fetch(`${BASE}/api/recipients/${token}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": synthIp() },
    // New-client behavior: transport-hash the raw PIN before sending.
    body: JSON.stringify({ pin: sha256hex(rawPin) }),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/octet-stream")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const metaB64 = res.headers.get("x-vaultdrop-meta") ?? "";
    let header: any = null;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(metaB64)));
    } catch { /* keep null */ }
    return { status: res.status, kind: "binary" as const, bytes: buf, header };
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, kind: "json" as const, body };
}

function base64UrlDecode(str: string): Uint8Array {
  let s = str;
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) throw new Error("bad b64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function storagePathOf(deliveryId: string): Promise<string | null> {
  const { data } = await admin.from("deliveries").select("storage_path").eq("id", deliveryId).single();
  return data?.storage_path ?? null;
}

async function objectExists(path: string): Promise<boolean> {
  const { error } = await admin.storage.from("vaultdrop-files").download(path);
  return !error;
}

async function main() {
  console.log("\n== Unit: crypto primitives ==");

  // 1. Random-bytes round trip
  {
    const key = generateFileKey();
    const data = new Uint8Array(Array.from({ length: 1024 }, (_, i) => (i * 7 + 13) % 256));
    const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(data, key);
    const back = await decryptBytesWithRawKey(ciphertext, key, nonceB64);
    ok(Buffer.from(back).equals(Buffer.from(data)), "random bytes round trip");
  }

  // 2. PDF-like round trip
  {
    const key = generateFileKey();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n%vaultdrop-test"), Buffer.alloc(5000, 0x42)]);
    const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(new Uint8Array(pdf), key);
    const back = await decryptBytesWithRawKey(ciphertext, key, nonceB64);
    ok(Buffer.from(back).equals(pdf), "PDF buffer round trip");
  }

  // 3. PNG-like round trip
  {
    const key = generateFileKey();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 0x37)]);
    const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(new Uint8Array(png), key);
    const back = await decryptBytesWithRawKey(ciphertext, key, nonceB64);
    ok(Buffer.from(back).equals(png), "PNG buffer round trip");
  }

  // 4. Wrong PIN rejects (GCM auth failure)
  {
    const key = generateFileKey();
    const wrapped = await wrapFileKeyForRecipient(key, "123456");
    let threw = false;
    try {
      await unwrapFileKeyWithPin(wrapped.encryptedData, wrapped.nonce, wrapped.salt, wrapped.iterations, "654321");
    } catch {
      threw = true;
    }
    ok(threw, "wrong PIN fails to unwrap content key");
  }

  console.log("\n== Creation & metadata ==");

  // 5. Create + shape (non-burn so later scenarios can inspect state)
  const mainDrop = await createFileDrop({ maxViews: 5, burnAfterReading: false });
  ok(Boolean(mainDrop.id && mainDrop.token && mainDrop.creatorToken), "file drop created via /api/delivery/file");

  // 6. Metadata exposes file info, never storage internals
  {
    const r = await req(`/api/recipients/${mainDrop.token}`);
    const d = r.body?.data ?? {};
    ok(d.kind === "file", "metadata reports kind=file");
    ok(d.fileName === mainDrop.fileName, "metadata exposes original filename");
    ok(typeof d.fileSize === "number" && d.fileSize > 0, "metadata exposes file size");
    const raw = JSON.stringify(r.body);
    ok(!raw.includes("storage_path") && !raw.includes("storagePath"), "metadata leaks no storage path");
    ok(!raw.includes("%PDF"), "no plaintext markers in metadata");
  }

  // 17/18. Storage path randomization + original filename absence
  {
    const other = await createFileDrop({});
    const a = await storagePathOf(mainDrop.id);
    const b = await storagePathOf(other.id);
    ok(!!a && !!b && a !== b, "two drops get distinct object paths");
    const pathRe = /^deliveries\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.bin$/;
    ok(pathRe.test(a!) && pathRe.test(b!), "paths are randomized deliveries/<id>/<rand>.bin");
    ok(!a!.includes(".pdf") && !a!.includes("topsecret"), "object path hides original filename");
    await admin.storage.from("vaultdrop-files").remove([b]);
  }

  console.log("\n== Access control ==");

  // 7. Wrong PIN
  {
    const r = await access(mainDrop.token, "000000");
    ok(r.status === 403, "wrong PIN rejected 403", r);
  }

  // 16. Unsupported MIME rejected server-side
  {
    let status = 0;
    try {
      await createFileDrop({ mime: "application/x-msdownload" });
    } catch (e: any) {
      status = Number((e.message.match(/failed: (\d+)/) || [])[1] || 0);
    }
    ok(status === 415, "unsupported MIME type rejected 415");
  }

  // 15. Oversized rejected server-side
  {
    let status = 0;
    try {
      await createFileDrop({ bytes: Buffer.alloc(26 * 1024 * 1024, 0x11) });
    } catch (e: any) {
      status = Number((e.message.match(/failed: (\d+)/) || [])[1] || 0);
    }
    ok(status === 413, "26MB upload rejected 413");
  }

  console.log("\n== Happy path: download + decrypt ==");

  // 8. Correct PIN streams ciphertext; browser-side decrypt reproduces file
  {
    const r = await access(mainDrop.token, mainDrop.pin);
    ok(r.kind === "binary" && r.status === 200, "access returns encrypted binary stream");
    const fileKey = await unwrapFileKeyWithPin(r.header.wrapped.e, r.header.wrapped.n, r.header.wrapped.s, r.header.wrapped.it, mainDrop.pin);
    const back = await decryptBytesWithRawKey(r.bytes, fileKey, r.header.iv);
    ok(Buffer.from(back).equals(Buffer.from(mainDrop.plain)), "decrypted bytes equal original plaintext");
    ok(!Buffer.from(r.bytes).includes(Buffer.from("%PDF")), "response body contains no plaintext markers");
    ok(r.header.destroyed === false, "non-burn open reports destroyed=false");
  }

  // 9. Stored object holds ciphertext only
  {
    const path = (await storagePathOf(mainDrop.id))!;
    const { data } = await admin.storage.from("vaultdrop-files").download(path);
    const stored = Buffer.from(await (data as Blob).arrayBuffer());
    ok(!stored.includes(Buffer.from("%PDF")), "stored object has no plaintext markers");
    ok(!stored.equals(Buffer.from(mainDrop.plain)), "stored bytes differ from plaintext");
    ok(stored.length > 0, "stored object exists (ciphertext)");
    await admin.storage.from("vaultdrop-files").remove([path]);
  }

  console.log("\n== Max views ==");

  // 10. maxViews=2: two opens succeed, third fails, blob deleted
  {
    const drop = await createFileDrop({ maxViews: 2, burnAfterReading: false });
    const o1 = await access(drop.token, drop.pin);
    const o2 = await access(drop.token, drop.pin);
    const o3 = await access(drop.token, drop.pin);
    ok(o1.status === 200 && o2.status === 200, "opens 1 and 2 succeed under maxViews=2");
    ok(o2.header?.destroyed === true, "second open triggers destruction signal");
    ok(o3.kind === "json" && o3.status === 410, "third open rejected 410");
    await new Promise((r) => setTimeout(r, 300));
    const path = await storagePathOf(drop.id);
    const stillThere = path ? await objectExists(path) : false;
    ok(!stillThere, "blob deleted after final permitted view");
  }

  console.log("\n== Burn-after-reading ==");

  // 11. Burn: single open destroys copy + blob
  {
    const drop = await createFileDrop({ burnAfterReading: true });
    const o1 = await access(drop.token, drop.pin);
    const o2 = await access(drop.token, drop.pin);
    ok(o1.status === 200 && o1.header?.destroyed === true, "burn open succeeds and flags destroyed");
    ok(o2.kind === "json" && o2.status === 410, "second access after burn rejected 410");
    const path = await storagePathOf(drop.id);
    const stillThere = path ? await objectExists(path) : false;
    ok(!stillThere, "encrypted blob deleted after burn");
  }

  console.log("\n== Expiration ==");

  // 12. Expired drop denied; blob removed
  {
    const drop = await createFileDrop({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const r = await access(drop.token, drop.pin);
    ok(r.kind === "json" && r.status === 410, "expired file drop rejected 410");
    await new Promise((res) => setTimeout(res, 300));
    const path = await storagePathOf(drop.id);
    const stillThere = path ? await objectExists(path) : false;
    ok(!stillThere, "expired drop blob deleted");
  }

  console.log("\n== Revocation ==");

  // 13. Creator revoke-all wipes blob
  {
    const drop = await createFileDrop({});
    const rev = await req(`/api/delivery/${drop.id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ creatorToken: drop.creatorToken }),
    });
    ok(rev.status === 200, "delivery revoked by creator");
    const r = await access(drop.token, drop.pin);
    ok(r.status === 410, "revoked drop access rejected 410");
    const path = await storagePathOf(drop.id);
    const stillThere = path ? await objectExists(path) : false;
    ok(!stillThere, "revoked drop blob deleted");
  }

  console.log("\n== Concurrency ==");

  // 14. Six parallel opens on a burn drop: exactly one wins
  {
    const drop = await createFileDrop({ burnAfterReading: true });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => access(drop.token, drop.pin)),
    );
    const winners = results.filter((r) => r.status === 200).length;
    ok(winners === 1, "exactly one concurrent opener wins", results.map((r) => r.status));
  }

  console.log("\n== Lockout on file drops ==");

  // 20. Five wrong PINs destroy the recipient copy + blob
  {
    const drop = await createFileDrop({});
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const r = await access(drop.token, String(100000 + i));
      lastStatus = r.status;
    }
    ok(lastStatus === 423, "5th wrong PIN locks and destroys (423)", lastStatus);
    const path = await storagePathOf(drop.id);
    const stillThere = path ? await objectExists(path) : false;
    ok(!stillThere, "locked file-drop blob deleted");
  }

  console.log("\n== Private bucket ==");

  // 17. No anonymous/public access to stored objects
  {
    const drop = await createFileDrop({});
    const path = (await storagePathOf(drop.id))!;
    const publicUrl = `${SB_URL}/storage/v1/object/public/vaultdrop-files/${path}`;
    const pubRes = await fetch(publicUrl);
    ok(pubRes.status >= 400, "public object URL denied (bucket not public)");
    const rawRes = await fetch(`${SB_URL}/storage/v1/object/vaultdrop-files/${path}`);
    ok(rawRes.status >= 400, "unauthenticated object fetch denied");
    const anonClient = createClient(SB_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-placeholder", { auth: { persistSession: false } });
    const { error } = await anonClient.storage.from("vaultdrop-files").download(path);
    ok(Boolean(error), "anon-key SDK download denied");
    await admin.storage.from("vaultdrop-files").remove([path]);
  }

  console.log("\n== Text-secret regression ==");

  // 19. Legacy text flow untouched
  {
    const { encryptSecret, decryptSecret } = await import("../src/lib/crypto.ts");
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const secret = `TEXT_REGRESSION_${Date.now()}`;
    const enc = await encryptSecret(secret, pin);
    const created = await req("/api/delivery", {
      method: "POST",
      headers: { "X-Forwarded-For": synthIp() },
      body: JSON.stringify({
        recipients: [{ name: null, pin: sha256hex(pin), encryptedData: enc.encryptedData, nonce: enc.nonce, salt: enc.salt, iterations: enc.iterations }],
        maxViews: 1,
        expiresAt: null,
        burnAfterReading: true,
        title: `text-regression-${Date.now()}`,
        contentType: "text/plain",
      }),
    });
    ok(created.status === 200, "text drop still creates");
    const acc = await access(created.body.recipients[0].urlToken, pin);
    const decrypted = await decryptSecret(acc.body.data.encryptedData, acc.body.data.nonce, acc.body.data.salt, acc.body.data.iterations, pin);
    ok(decrypted === secret, "text drop decrypts identically");
  }

  console.log(`\n========================================`);
  console.log(`FILE SUITE: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Suite crashed:", e);
  process.exit(1);
});
