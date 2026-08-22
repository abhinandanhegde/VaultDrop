import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDeliveryId } from "@/lib/crypto";

// =====================================================
// Encrypted file storage (Supabase Storage)
// =====================================================
// The bucket is PRIVATE (no policies; service-role only) and holds ONLY
// AES-256-GCM ciphertext uploaded as application/octet-stream. Original
// filenames are never used as object paths.

export const FILE_BUCKET = "vaultdrop-files";
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB
export const ENC_VERSION = 1;

// Common file types accepted at the API layer. Content is encrypted before
// storage, so this list is UX hygiene rather than a hard security boundary;
// it still blocks obviously non-document payloads from being shared.
export const ALLOWED_FILE_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Some browsers report an empty MIME for unknown/binary files. Treat that as
// generic binary rather than rejecting outright.
export function isAllowedFileType(mime: string | null | undefined): boolean {
  if (!mime || mime === "application/octet-stream") return true;
  return ALLOWED_FILE_MIMES.has(mime);
}

// Randomized object path: deliveries/<deliveryId>/<random>.bin
// The delivery id itself is a 128-bit random value; the object name adds
// another 128 bits. Never derived from user input.
export function randomObjectPath(deliveryId: string): string {
  return `deliveries/${deliveryId}/${generateDeliveryId()}.bin`;
}

function storageRef(client: SupabaseClient) {
  return client.storage.from(FILE_BUCKET);
}

export async function uploadEncryptedObject(
  client: SupabaseClient,
  path: string,
  data: ArrayBuffer,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await storageRef(client).upload(path, data, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function downloadEncryptedObject(
  client: SupabaseClient,
  path: string,
): Promise<{ data?: ArrayBuffer; error?: string }> {
  const { data, error } = await storageRef(client).download(path);
  if (error || !data) return { error: error?.message ?? "Object not found" };
  // supabase-js returns a Blob in browsers/Node 18+.
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { data: await data.arrayBuffer() };
  }
  const anyData = data as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyData.arrayBuffer === "function") {
    return { data: await anyData.arrayBuffer() };
  }
  return { data: data as unknown as ArrayBuffer };
}

export async function removeEncryptedObject(
  client: SupabaseClient,
  path: string,
): Promise<void> {
  try {
    await storageRef(client).remove([path]);
  } catch (error) {
    console.error("Storage remove error:", error);
  }
}

// Best-effort removal of a delivery's encrypted object.
export async function removeDeliveryFile(
  client: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  const { data } = await client
    .from("deliveries")
    .select("storage_path")
    .eq("id", deliveryId)
    .single();
  if (data?.storage_path) {
    await removeEncryptedObject(client, data.storage_path);
  }
}

// True while at least one recipient row still holds its wrapped key — i.e.
// someone may still legitimately open the shared encrypted blob.
export async function deliveryHasLiveCopies(
  client: SupabaseClient,
  deliveryId: string,
): Promise<boolean> {
  const { count } = await client
    .from("recipients")
    .select("id", { count: "exact", head: true })
    .eq("delivery_id", deliveryId)
    .not("encrypted_data", "is", null);
  return (count ?? 0) > 0;
}

// Delete the shared blob only when no recipient can consume it anymore
// (per-recipient lifecycle matches how text ciphertext is nulled).
export async function removeDeliveryFileIfFullyConsumed(
  client: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  if (await deliveryHasLiveCopies(client, deliveryId)) return;
  await removeDeliveryFile(client, deliveryId);
}
