import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPIN } from "@/lib/bcrypt";
import { generateDeliveryId, isHashedPin, ITERATIONS } from "@/lib/crypto";
import { createRateLimiter, clientIp } from "@/lib/ratelimit";

const RATE_LIMIT_MAX = 10; // max creations per IP per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_RECIPIENTS = 50;

const checkRateLimit = createRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW).allow;

interface RecipientInput {
  name?: string | null;
  pin: string;
  encryptedData: string;
  nonce: string;
  salt: string;
  iterations?: number;
}

function validateRecipient(r: RecipientInput): string | null {
  if (!r || typeof r !== "object") return "Invalid recipient entry";
  // Accepts a raw 6-digit PIN (legacy clients) or the preferred transport
  // form, SHA-256(pin) hex — which keeps the raw PIN client-side only.
  if (typeof r.pin !== "string" || !/^(?:\d{6}|[0-9a-f]{64})$/.test(r.pin)) {
    return "Each recipient needs a 6-digit numeric PIN";
  }
  if (!r.encryptedData || !r.nonce || !r.salt) {
    return "Each recipient needs encryptedData, nonce and salt";
  }
  if (typeof r.encryptedData !== "string" || r.encryptedData.length > 10_000_000) {
    return "Encrypted data too large";
  }
  if (r.name != null && (typeof r.name !== "string" || r.name.length > 100)) {
    return "Recipient name must be under 100 chars";
  }
  const it = r.iterations ?? ITERATIONS;
  if (it < 10000 || it > 1000000) {
    return "Iterations must be between 10000 and 1000000";
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      recipients,
      maxViews = 1,
      expiresAt = null,
      burnAfterReading = true,
      title = null,
      contentType = "text/plain",
      releaseAt = null,
      renewalWindowMinutes = null,
      // Legacy single-recipient fields (kept for backward compatibility)
      encryptedData,
      nonce,
      salt,
      iterations = ITERATIONS,
      pin,
    } = body;

    if (!title || typeof title !== "string" || title.length > 200) {
      return NextResponse.json(
        { status: "error", message: "Title is required (max 200 chars)" },
        { status: 400 },
      );
    }

    if (maxViews !== undefined && (typeof maxViews !== "number" || maxViews < 0 || maxViews > 10000)) {
      return NextResponse.json(
        { status: "error", message: "maxViews must be a non-negative number" },
        { status: 400 },
      );
    }

    if (releaseAt != null) {
      const releaseDate = new Date(releaseAt);
      if (isNaN(releaseDate.getTime())) {
        return NextResponse.json(
          { status: "error", message: "releaseAt must be a valid date-time" },
          { status: 400 },
        );
      }
      if (releaseDate.getTime() <= Date.now()) {
        return NextResponse.json(
          { status: "error", message: "releaseAt must be in the future" },
          { status: 400 },
        );
      }
      if (expiresAt && new Date(expiresAt).getTime() <= releaseDate.getTime()) {
        return NextResponse.json(
          { status: "error", message: "Expiration must be after the release time" },
          { status: 400 },
        );
      }
    }

    // Dead Man's Switch: a renewal window in minutes (e.g. "self-destructs in 10 min
    // unless I renew"). Deadline is set to now + window.
    let renewalDeadline: string | null = null;
    if (renewalWindowMinutes != null) {
      const w = Number(renewalWindowMinutes);
      if (!Number.isFinite(w) || w < 1 || w > 60 * 24 * 30) {
        return NextResponse.json(
          { status: "error", message: "renewalWindowMinutes must be between 1 and 43200" },
          { status: 400 },
        );
      }
      renewalDeadline = new Date(Date.now() + w * 60 * 1000).toISOString();
    }

    // Build the recipient list (multi-recipient array OR legacy single fields)
    let recipientList: RecipientInput[];
    if (Array.isArray(recipients)) {
      if (recipients.length === 0) {
        return NextResponse.json(
          { status: "error", message: "At least one recipient is required" },
          { status: 400 },
        );
      }
      if (recipients.length > MAX_RECIPIENTS) {
        return NextResponse.json(
          { status: "error", message: `Too many recipients (max ${MAX_RECIPIENTS})` },
          { status: 400 },
        );
      }
      recipientList = recipients;
    } else {
      if (!encryptedData || !nonce || !salt || !pin) {
        return NextResponse.json(
          { status: "error", message: "Missing required fields: encryptedData, nonce, salt, pin" },
          { status: 400 },
        );
      }
      recipientList = [{ name: null, pin, encryptedData, nonce, salt, iterations }];
    }

    for (const r of recipientList) {
      const err = validateRecipient(r);
      if (err) {
        return NextResponse.json({ status: "error", message: err }, { status: 400 });
      }
    }

    // PIN transport scheme: all recipients must use the same form. When pins
    // arrive as SHA-256 digests the raw PIN never reaches the server, so the
    // stored salt+iterations are useless without the client.
    const pinScheme = recipientList.some((r) => isHashedPin(r.pin)) ? "sha256" : "raw";
    if (pinScheme === "sha256" && recipientList.some((r) => !isHashedPin(r.pin))) {
      return NextResponse.json(
        { status: "error", message: "All recipients must use the same PIN format" },
        { status: 400 },
      );
    }

    // Rate limiting
    const ip = clientIp(request);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { status: "error", message: "Rate limit exceeded. Please try again later." },
        { status: 429 },
      );
    }

    const deliveryId = generateDeliveryId();
    const creatorToken = generateDeliveryId();

    const supabase = createClient();

    // Insert the delivery shell (policy + title). Ciphertext lives per-recipient.
    const first = recipientList[0];
    const firstPinHash = await hashPIN(first.pin);
    const { data, error } = await supabase
      .from("deliveries")
      .insert({
        id: deliveryId,
        encrypted_data: recipientList.length === 1 ? first.encryptedData : null,
        nonce: recipientList.length === 1 ? first.nonce : null,
        salt: recipientList.length === 1 ? first.salt : null,
        iterations: first.iterations ?? ITERATIONS,
        pin_hash: firstPinHash,
        pin_scheme: pinScheme,
        max_views: maxViews,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        release_at: releaseAt ? new Date(releaseAt).toISOString() : null,
        renewal_deadline: renewalDeadline,
        renewal_window_minutes: renewalDeadline ? Number(renewalWindowMinutes) : null,
        burn_after_reading: burnAfterReading,
        creator_token: creatorToken,
        status: "active",
        view_count: 0,
        failed_attempts: 0,
        title,
        content_type: contentType,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { status: "error", message: "Failed to create delivery" },
        { status: 500 },
      );
    }

    // Insert all recipients in one batch (single round-trip, no orphaned rows on partial failure)
    const pinHashes = await Promise.all(recipientList.map((r) => hashPIN(r.pin)));
    const recipientRows = recipientList.map((r, i) => ({
      delivery_id: deliveryId,
      name: r.name ?? null,
      url_token: generateDeliveryId(),
      pin_hash: pinHashes[i],
      encrypted_data: r.encryptedData,
      nonce: r.nonce,
      salt: r.salt,
      iterations: r.iterations ?? ITERATIONS,
      status: "pending",
      failed_attempts: 0,
      view_count: 0,
    }));

    const { data: recRows, error: recError } = await supabase
      .from("recipients")
      .insert(recipientRows)
      .select();

    if (recError) {
      console.error("Recipient insert error:", recError);
      return NextResponse.json(
        { status: "error", message: "Failed to create recipient" },
        { status: 500 },
      );
    }

    const createdRecipients: { id: string; name: string | null; urlToken: string; pin: string }[] =
      recipientRows.map((row, i) => ({
        id: recRows?.[i]?.id ?? row.url_token,
        name: row.name,
        urlToken: row.url_token,
        pin: recipientList[i].pin,
      }));

    // Log creation event
    await supabase.from("access_events").insert({
      delivery_id: deliveryId,
      event_type: "created",
      metadata: {
        ip,
        max_views: maxViews,
        expires_at: expiresAt,
        release_at: releaseAt,
        renewal_deadline: renewalDeadline,
        burnAfterReading,
        recipient_count: createdRecipients.length,
      },
    });

    return NextResponse.json({
      status: "ok",
      id: data.id,
      creatorToken: data.creator_token,
      recipients: createdRecipients,
    });
  } catch (error) {
    console.error("Create delivery error:", error);
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