import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPIN } from "@/lib/bcrypt";
import {
  generateDeliveryId,
  isHashedPin,
  ITERATIONS,
} from "@/lib/crypto";
import { createRateLimiter, clientIp } from "@/lib/ratelimit";
import {
  MAX_FILE_BYTES,
  ENC_VERSION,
  isAllowedFileType,
  randomObjectPath,
  uploadEncryptedObject,
  removeEncryptedObject,
} from "@/lib/storage";

// Mirrors the text-secret creation route's limits so both flows behave alike.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const MAX_RECIPIENTS = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 255;

const checkRateLimit = createRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW).allow;

interface WrappedKeyBundle {
  encryptedData?: unknown;
  nonce?: unknown;
  salt?: unknown;
  iterations?: unknown;
}

interface FileRecipientInput {
  name?: string | null;
  pin?: unknown;
  wrapped?: WrappedKeyBundle;
}

function validatePolicy(
  title: unknown,
  maxViews: unknown,
  expiresAt: unknown,
  releaseAt: unknown,
  renewalWindowMinutes: unknown,
): { error?: string; normalized: {
  title: string;
  maxViews: number;
  expiresAtIso: string | null;
  releaseAtIso: string | null;
  renewalDeadline: string | null;
  burnAfterReading: boolean;
  renewalWindowMinutesRaw: number | null;
} } {
  if (!title || typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
    return { error: `Title is required (max ${MAX_TITLE_LENGTH} chars)`, normalized: null as never };
  }

  const mv = typeof maxViews === "number" ? maxViews : Number(maxViews ?? 1);
  if (!Number.isFinite(mv) || mv < 0 || mv > 10000) {
    return { error: "maxViews must be a non-negative number", normalized: null as never };
  }

  let expiresAtIso: string | null = null;
  if (expiresAt != null && expiresAt !== "") {
    const d = new Date(String(expiresAt));
    if (isNaN(d.getTime())) return { error: "expiresAt must be a valid date-time", normalized: null as never };
    expiresAtIso = d.toISOString();
  }

  let releaseAtIso: string | null = null;
  if (releaseAt != null && releaseAt !== "") {
    const d = new Date(String(releaseAt));
    if (isNaN(d.getTime())) return { error: "releaseAt must be a valid date-time", normalized: null as never };
    if (d.getTime() <= Date.now()) return { error: "releaseAt must be in the future", normalized: null as never };
    if (expiresAtIso && new Date(expiresAtIso).getTime() <= d.getTime()) {
      return { error: "Expiration must be after the release time", normalized: null as never };
    }
    releaseAtIso = d.toISOString();
  }

  let renewalDeadline: string | null = null;
  let renewalWindowMinutesRaw: number | null = null;
  if (renewalWindowMinutes != null && renewalWindowMinutes !== "") {
    const w = Number(renewalWindowMinutes);
    if (!Number.isFinite(w) || w < 1 || w > 60 * 24 * 30) {
      return { error: "renewalWindowMinutes must be between 1 and 43200", normalized: null as never };
    }
    renewalDeadline = new Date(Date.now() + w * 60 * 1000).toISOString();
    renewalWindowMinutesRaw = w;
  }

  return {
    normalized: {
      title: title as string,
      maxViews: mv,
      expiresAtIso,
      releaseAtIso,
      renewalDeadline,
      burnAfterReading: true,
      renewalWindowMinutesRaw,
    },
  };
}

function validateRecipient(r: FileRecipientInput): string | null {
  if (!r || typeof r !== "object") return "Invalid recipient entry";
  // Same transport forms as the text flow: raw 6-digit PIN (legacy) or the
  // preferred SHA-256(pin) hex digest that keeps the raw PIN client-side.
  if (typeof r.pin !== "string" || !/^(?:\d{6}|[0-9a-f]{64})$/.test(r.pin)) {
    return "Each recipient needs a 6-digit numeric PIN";
  }
  const w = r.wrapped;
  if (!w || typeof w !== "object") {
    return "Each recipient needs a wrapped key bundle";
  }
  if (
    typeof w.encryptedData !== "string" ||
    w.encryptedData.length < 16 ||
    w.encryptedData.length > 512 ||
    typeof w.nonce !== "string" ||
    w.nonce.length > 64 ||
    typeof w.salt !== "string" ||
    w.salt.length > 128
  ) {
    return "Invalid wrapped key bundle";
  }
  const it = w.iterations == null ? ITERATIONS : Number(w.iterations);
  if (!Number.isFinite(it) || it < 10000 || it > 1000000) {
    return "Iterations must be between 10000 and 1000000";
  }
  if (r.name != null && (typeof r.name !== "string" || r.name.length > 100)) {
    return "Recipient name must be under 100 chars";
  }
  return null;
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { status: "error", message: "Rate limit exceeded. Please try again later." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { status: "error", message: "Expected multipart/form-data" },
        { status: 400 },
      );
    }

    const file = form.get("file");
    const metaRaw = form.get("meta");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { status: "error", message: "Missing encrypted file blob" },
        { status: 400 },
      );
    }
    if (typeof metaRaw !== "string") {
      return NextResponse.json(
        { status: "error", message: "Missing metadata" },
        { status: 400 },
      );
    }

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(metaRaw) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { status: "error", message: "Invalid metadata JSON" },
        { status: 400 },
      );
    }

    const burnAfterReading =
      meta.burnAfterReading === undefined ? true : Boolean(meta.burnAfterReading);

    const policy = validatePolicy(
      meta.title,
      meta.maxViews === undefined ? (burnAfterReading ? 1 : 3) : meta.maxViews,
      meta.expiresAt,
      meta.releaseAt,
      meta.renewalWindowMinutes,
    );
    if (policy.error) {
      return NextResponse.json(
        { status: "error", message: policy.error },
        { status: 400 },
      );
    }

    // ---- File validation (server-side size + MIME) -----------------------
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { status: "error", message: `File must be between 1 byte and ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
        { status: 413 },
      );
    }
    const declaredMime = typeof meta.fileMime === "string" ? (meta.fileMime as string) : "";
    const effectiveMime = declaredMime || file.type || "application/octet-stream";
    if (!isAllowedFileType(effectiveMime)) {
      return NextResponse.json(
        { status: "error", message: "Unsupported file type" },
        { status: 415 },
      );
    }
    const fileNameRaw = typeof meta.fileName === "string" ? (meta.fileName as string) : "file";
    const fileName = fileNameRaw.slice(0, MAX_FILE_NAME_LENGTH);

    // The client-generated IV for the file ciphertext. Stored verbatim; it is
    // not secret and is required by recipients to decrypt locally.
    const fileNonce = typeof meta.fileNonce === "string" ? meta.fileNonce : "";
    if (!isBase64(fileNonce) || fileNonce.length > 64) {
      return NextResponse.json(
        { status: "error", message: "Invalid file nonce" },
        { status: 400 },
      );
    }

    // ---- Recipients ------------------------------------------------------
    const rawRecipients = Array.isArray(meta.recipients) ? meta.recipients : [];
    if (rawRecipients.length === 0) {
      return NextResponse.json(
        { status: "error", message: "At least one recipient is required" },
        { status: 400 },
      );
    }
    if (rawRecipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { status: "error", message: `Too many recipients (max ${MAX_RECIPIENTS})` },
        { status: 400 },
      );
    }
    const recipientList = rawRecipients as FileRecipientInput[];
    for (const r of recipientList) {
      const err = validateRecipient(r);
      if (err) {
        return NextResponse.json({ status: "error", message: err }, { status: 400 });
      }
    }

    // Same uniform-PIN-scheme rule as the text flow.
    const pins = recipientList.map((r) => r.pin as string);
    const pinScheme = pins.some((p) => isHashedPin(p)) ? "sha256" : "raw";
    if (pinScheme === "sha256" && pins.some((p) => !isHashedPin(p))) {
      return NextResponse.json(
        { status: "error", message: "All recipients must use the same PIN format" },
        { status: 400 },
      );
    }

    // ---- Persist: storage first, then database rows ----------------------
    // If anything fails after the upload, every artifact created so far is
    // cleaned up — no partially valid deliveries and no orphaned objects.
    const supabase = createClient();
    const deliveryId = generateDeliveryId();
    const creatorToken = generateDeliveryId();
    const storagePath = randomObjectPath(deliveryId);

    const encBytes = await file.arrayBuffer();
    const uploadResult = await uploadEncryptedObject(supabase, storagePath, encBytes);
    if (!uploadResult.ok) {
      console.error("Storage upload error:", uploadResult.error);
      return NextResponse.json(
        { status: "error", message: "Failed to store encrypted file" },
        { status: 500 },
      );
    }

    const first = recipientList[0];
    const firstWrapped = first.wrapped as Required<Omit<WrappedKeyBundle, "iterations">> & { iterations?: number };
    const firstPinHash = await hashPIN(pins[0]);

    const { data, error } = await supabase
      .from("deliveries")
      .insert({
        id: deliveryId,
        kind: "file",
        encrypted_data: null,
        nonce: null,
        salt: null,
        iterations: Number(firstWrapped.iterations ?? ITERATIONS),
        pin_hash: firstPinHash,
        pin_scheme: pinScheme,
        max_views: policy.normalized.maxViews,
        expires_at: policy.normalized.expiresAtIso,
        release_at: policy.normalized.releaseAtIso,
        renewal_deadline: policy.normalized.renewalDeadline,
        renewal_window_minutes: policy.normalized.renewalWindowMinutesRaw,
        burn_after_reading: burnAfterReading,
        creator_token: creatorToken,
        status: "active",
        view_count: 0,
        failed_attempts: 0,
        title: policy.normalized.title,
        content_type: effectiveMime,
        created_at: new Date().toISOString(),
        file_name: fileName,
        file_mime: effectiveMime,
        file_size: file.size,
        storage_path: storagePath,
        file_nonce: fileNonce,
        enc_version: ENC_VERSION,
      })
      .select()
      .single();

    if (error) {
      console.error("Delivery insert error:", error);
      await removeEncryptedObject(supabase, storagePath);
      return NextResponse.json(
        { status: "error", message: "Failed to create delivery" },
        { status: 500 },
      );
    }

    const pinHashes = await Promise.all(pins.map((p) => hashPIN(p)));
    const recipientRows = recipientList.map((r, i) => {
      const w = r.wrapped!;
      return {
        delivery_id: deliveryId,
        name: r.name ?? null,
        url_token: generateDeliveryId(),
        pin_hash: pinHashes[i],
        encrypted_data: w.encryptedData as string,
        nonce: w.nonce as string,
        salt: w.salt as string,
        iterations: Number(w.iterations ?? ITERATIONS),
        status: "pending",
        failed_attempts: 0,
        view_count: 0,
      };
    });

    const { data: recRows, error: recError } = await supabase
      .from("recipients")
      .insert(recipientRows)
      .select();

    if (recError) {
      console.error("Recipient insert error:", recError);
      await removeEncryptedObject(supabase, storagePath);
      await supabase.from("deliveries").delete().eq("id", deliveryId);
      return NextResponse.json(
        { status: "error", message: "Failed to create recipient" },
        { status: 500 },
      );
    }

    const createdRecipients = recipientRows.map((row, i) => ({
      id: recRows?.[i]?.id ?? row.url_token,
      name: row.name,
      urlToken: row.url_token,
      pin: pins[i],
    }));

    await supabase.from("access_events").insert({
      delivery_id: deliveryId,
      event_type: "created",
      metadata: {
        ip,
        kind: "file",
        max_views: policy.normalized.maxViews,
        expires_at: policy.normalized.expiresAtIso,
        release_at: policy.normalized.releaseAtIso,
        renewal_deadline: policy.normalized.renewalDeadline,
        burnAfterReading,
        recipient_count: createdRecipients.length,
        file_size: file.size,
      },
    });

    return NextResponse.json({
      status: "ok",
      id: data.id,
      creatorToken: data.creator_token,
      recipients: createdRecipients,
    });
  } catch (error) {
    console.error("Create file delivery error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { status: "error", message: "This endpoint only supports POST" },
    { status: 405 },
  );
}
