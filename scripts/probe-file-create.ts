import { generateFileKey, encryptBytesWithRawKey, wrapFileKeyForRecipient } from "../src/lib/crypto.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3003";
const pin = String(Math.floor(100000 + Math.random() * 900000));
const bytes = new TextEncoder().encode("%PDF-1.4 probe " + Date.now());

const t0 = Date.now();
const dek = await generateFileKey();
const { ciphertext, nonceB64 } = await encryptBytesWithRawKey(bytes, dek);
const wrapped = await wrapFileKeyForRecipient(dek, pin);
dek.fill(0);

const fd = new FormData();
fd.append("file", new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" }), "probe.bin");
fd.append("meta", JSON.stringify({
  title: "Probe",
  recipients: [{ name: "R", pin, wrapped }],
  maxViews: 1,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  burnAfterReading: true,
  fileName: "probe.pdf",
  fileMime: "application/pdf",
  fileNonce: nonceB64,
}));

const res = await fetch(`${BASE}/api/delivery/file`, { method: "POST", body: fd });
const text = await res.text();
console.log(`status=${res.status} ms=${Date.now() - t0} body=${text.slice(0, 300)}`);
