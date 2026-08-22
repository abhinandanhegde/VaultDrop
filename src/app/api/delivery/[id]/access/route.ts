import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePIN } from "@/lib/bcrypt";
import { MAX_PIN_ATTEMPTS } from "@/lib/crypto";
import { deadManTriggered, destroyForDeadManSwitch, logDeadManSwitch } from "@/lib/deadman";
import { createRateLimiter, clientIp } from "@/lib/ratelimit";

const checkPinRateLimit = createRateLimiter(5, 15 * 60 * 1000).allow;

const PIN_RATE_LIMIT_MAX = 5;
const PIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// DB-backed sliding-window throttle (same RPC the recipient route uses).
// Unlike the in-memory limiter it survives restarts and holds across
// multiple server instances. Migration 007 made this RPC accept a direct
// delivery id as well as a recipient url_token.
async function checkPinRateLimitDb(supabase: ReturnType<typeof createClient>, id: string, ip: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const windowStart = new Date(Date.now() - PIN_RATE_LIMIT_WINDOW_MS).toISOString();

  const { data, error } = await supabase.rpc("check_pin_rate_limit", {
    p_token: id,
    p_ip: ip,
    p_window_start: windowStart,
    p_max_attempts: PIN_RATE_LIMIT_MAX,
  });

  if (error) {
    console.error("Rate limit check error:", error);
    return { allowed: true };
  }

  return data as { allowed: boolean; retryAfterMs?: number };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { pin } = body;

    // Accept either transport form: a 6-digit PIN (legacy scheme) or the
    // SHA-256 hex digest of a PIN (hashed scheme). Wrong-scheme values simply
    // fail bcrypt comparison with the same generic error as a wrong PIN.
    if (!pin || typeof pin !== "string" || !/^(?:\d{6}|[0-9a-f]{64})$/.test(pin)) {
      return NextResponse.json(
        { status: "error", message: "Invalid PIN format" },
        { status: 400 },
      );
    }

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { status: "error", message: "Invalid delivery ID" },
        { status: 400 },
      );
    }

    // Rate limit PIN attempts (cheap in-memory first gate)
    const ip = clientIp(request);
    const rateKey = `${id}:${ip}`;
    if (!checkPinRateLimit(rateKey)) {
      return NextResponse.json(
        { status: "error", message: "Too many attempts. Please wait 15 minutes." },
        { status: 429 },
      );
    }

    const supabase = createClient();

    // Distributed throttle (survives restarts, shared across instances)
    const rateLimitDb = await checkPinRateLimitDb(supabase, id, ip);
    if (!rateLimitDb.allowed) {
      const headers: Record<string, string> = {};
      if (rateLimitDb.retryAfterMs) {
        headers["Retry-After"] = String(Math.ceil((rateLimitDb.retryAfterMs || 0) / 1000));
      }
      return NextResponse.json(
        { status: "error", message: "Too many attempts. Please try again later." },
        { status: 429, headers },
      );
    }

    // Fetch the delivery with its PIN hash and policy
    const { data: delivery, error: fetchError } = await supabase
      .from("deliveries")
      .select("id, encrypted_data, nonce, salt, iterations, pin_hash, max_views, status, failed_attempts, view_count, burn_after_reading, expires_at, release_at, renewal_deadline, title, content_type")
      .eq("id", id)
      .single();

    if (fetchError || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Delivery not found or expired" },
        { status: 404 },
      );
    }

    // Check delivery status
    if (delivery.status === "expired") {
      return NextResponse.json(
        { status: "error", message: "This delivery has expired" },
        { status: 410 },
      );
    }

    if (delivery.status === "revoked") {
      return NextResponse.json(
        { status: "error", message: "This delivery was revoked by the creator" },
        { status: 410 },
      );
    }

    if (delivery.status === "destroyed" || delivery.status === "accessed") {
      return NextResponse.json(
        { status: "error", message: "This secret is no longer available" },
        { status: 410 },
      );
    }

    if (delivery.status === "locked") {
      return NextResponse.json(
        { status: "error", message: "This delivery is locked due to too many failed attempts" },
        { status: 410 },
      );
    }

    // Multi-recipient deliveries carry per-recipient ciphertext only.
    // Refuse BEFORE any policy mutation so a legacy probe cannot burn the drop.
    if (!delivery.encrypted_data || !delivery.nonce || !delivery.salt) {
      return NextResponse.json(
        { status: "error", message: "This is a multi-recipient delivery. Please use the recipient-specific link." },
        { status: 400 },
      );
    }

    // Time-lock: not yet released
    if (delivery.release_at) {
      const releaseDate = new Date(delivery.release_at);
      if (releaseDate > new Date()) {
        return NextResponse.json(
          {
            status: "error",
            message: "This drop is time-locked and not yet released.",
            releaseAt: delivery.release_at,
          },
          { status: 423 },
        );
      }
    }

    // Dead Man's Switch: if the creator never renewed, self-destruct
    if (deadManTriggered(delivery.renewal_deadline)) {
      await destroyForDeadManSwitch(supabase, delivery.id);
      await logDeadManSwitch(supabase, delivery.id, ip);
      return NextResponse.json(
        { status: "error", message: "The sender stopped renewing this drop. It has self-destructed." },
        { status: 410 },
      );
    }

    // Lazy expiration: enforced BEFORE any PIN work so expired drops are
    // wiped regardless of what PIN is presented (matches recipient route).
    if (delivery.expires_at && new Date(delivery.expires_at) < new Date()) {
      await supabase
        .from("deliveries")
        .update({ status: "expired" })
        .eq("id", id);

      await supabase.from("access_events").insert({
        delivery_id: id,
        event_type: "expired",
        metadata: { ip },
      });

      await supabase
        .from("deliveries")
        .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
        .eq("id", id);

      return NextResponse.json(
        { status: "error", message: "This delivery has expired" },
        { status: 410 },
      );
    }

    // Validate PIN
    const isValid = await validatePIN(pin, delivery.pin_hash);

    if (!isValid) {
      // Atomic failed-attempt counting. Preferred path: a single-statement
      // SQL increment (migration 006) which is contention-proof. Fallback:
      // optimistic CAS on the previous value if the RPC is not deployed yet.
      let newFailedAttempts = 0;
      let counted = false;

      const { data: rpcCount, error: rpcError } = await supabase.rpc(
        "record_failed_attempt_delivery",
        { p_delivery_id: id }
      );
      if (!rpcError && typeof rpcCount === "number") {
        newFailedAttempts = rpcCount;
        counted = true;
      } else {
        for (let attempt = 0; attempt < 5 && !counted; attempt++) {
          const { data: cur } = await supabase
            .from("deliveries")
            .select("failed_attempts")
            .eq("id", id)
            .single();
          const prev = (cur?.failed_attempts as number) ?? 0;
          newFailedAttempts = prev + 1;
          const { data: incRows } = await supabase
            .from("deliveries")
            .update({ failed_attempts: newFailedAttempts })
            .eq("id", id)
            .eq("failed_attempts", prev)
            .select("failed_attempts");
          if (incRows && incRows.length > 0) counted = true;
        }
      }
      const remaining = MAX_PIN_ATTEMPTS - newFailedAttempts;

      // Lock the delivery if max attempts exceeded
      if (counted && newFailedAttempts >= MAX_PIN_ATTEMPTS) {
        await supabase
          .from("deliveries")
          .update({
            status: "locked",
            failed_attempts: newFailedAttempts,
            encrypted_data: null,
            nonce: null,
            salt: null,
            pin_hash: null,
          })
          .eq("id", id);

        await supabase.from("access_events").insert({
          delivery_id: id,
          event_type: "locked",
          metadata: { reason: "max_failed_attempts", ip },
        });

        await supabase.from("access_events").insert({
          delivery_id: id,
          event_type: "destroyed",
          metadata: { reason: "pin_lockout", ip },
        });

        return NextResponse.json(
          { status: "error", message: "Too many wrong PINs. This drop has been destroyed." },
          { status: 423 },
        );
      }

      await supabase.from("access_events").insert({
        delivery_id: id,
        event_type: "pin_failed",
        metadata: { ip, remaining },
      });

      return NextResponse.json(
        { status: "error", message: "Invalid PIN", remainingAttempts: remaining },
        { status: 403 },
      );
    }

    // PIN is valid — serve the encrypted data

    // Log successful PIN validation
    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "pin_validated",
      metadata: { ip },
    });

    // Multi-recipient deliveries carry their ciphertext per recipient;
    // the recipient-specific endpoint must be used instead.
    if (!delivery.encrypted_data || !delivery.nonce || !delivery.salt) {
      return NextResponse.json(
        { status: "error", message: "This is a multi-recipient delivery. Please use the recipient-specific link." },
        { status: 400 },
      );
    }

    // Check view count / max views
    const newViewCount = (delivery.view_count || 0) + 1;
    const isMaxReached = delivery.max_views > 0 && newViewCount >= delivery.max_views;
    const shouldBurn = delivery.burn_after_reading || isMaxReached;

    // Optimistic concurrency control: the update only lands if view_count is
    // unchanged since our SELECT. This guarantees exactly one consumer of a
    // one-time secret — concurrent losers get 410 and never see ciphertext.
    const statusUpdate: Record<string, unknown> = {
      view_count: newViewCount,
      accessed_at: new Date().toISOString(),
    };

    if (shouldBurn) {
      statusUpdate.status = "destroyed";
      statusUpdate.destroyed_at = new Date().toISOString();
      statusUpdate.encrypted_data = null;
      statusUpdate.nonce = null;
      statusUpdate.salt = null;
      statusUpdate.pin_hash = null;
    }

    const { data: casRows, error: updateError } = await supabase
      .from("deliveries")
      .update(statusUpdate)
      .eq("id", id)
      .eq("view_count", delivery.view_count || 0)
      .select("id");

    if (updateError) {
      console.error("Failed to update delivery status:", updateError);
      return NextResponse.json(
        { status: "error", message: "Internal server error" },
        { status: 500 },
      );
    }

    if (!casRows || casRows.length === 0) {
      // Another request won the race — the one-time allowance is spent.
      return NextResponse.json(
        { status: "error", message: "This secret is no longer available" },
        { status: 410 },
      );
    }

    // Log access event
    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "accessed",
      metadata: { ip, view_count: newViewCount },
    });

    if (shouldBurn) {
      await supabase.from("access_events").insert({
        delivery_id: id,
        event_type: "destroyed",
        metadata: { reason: "burn_after_reading", view_count: newViewCount },
      });
    }

    return NextResponse.json({
      status: "ok",
      data: {
        encryptedData: delivery.encrypted_data,
        nonce: delivery.nonce,
        salt: delivery.salt,
        iterations: delivery.iterations,
        contentType: delivery.content_type,
        title: delivery.title,
        burnAfterReading: delivery.burn_after_reading,
      },
      destroyed: shouldBurn,
      message: shouldBurn
        ? "This was a one-time delivery. The secret has been destroyed."
        : undefined,
    });
  } catch (error) {
    console.error("Access delivery error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}
