import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePIN } from "@/lib/bcrypt";
import { MAX_PIN_ATTEMPTS } from "@/lib/crypto";
import { deadManTriggered, destroyForDeadManSwitch, wipeRecipientCopies, logDeadManSwitch } from "@/lib/deadman";
import { clientIp } from "@/lib/ratelimit";

const PIN_RATE_LIMIT_MAX = 5;
const PIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

async function checkPinRateLimitDb(supabase: ReturnType<typeof createClient>, token: string, ip: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const windowStart = new Date(Date.now() - PIN_RATE_LIMIT_WINDOW_MS).toISOString();

  const { data, error } = await supabase.rpc("check_pin_rate_limit", {
    p_token: token,
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { pin } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { status: "error", message: "Invalid link" },
        { status: 400 },
      );
    }

    // Accept either transport form: a 6-digit PIN (legacy scheme) or the
    // SHA-256 hex digest of a PIN (hashed scheme). Wrong-scheme values simply
    // fail bcrypt comparison with the same generic error as a wrong PIN.
    if (!pin || typeof pin !== "string" || !/^(?:\d{6}|[0-9a-f]{64})$/.test(pin)) {
      return NextResponse.json(
        { status: "error", message: "Invalid PIN format" },
        { status: 400 },
      );
    }

    const ip = clientIp(request);
    const supabase = createClient();

    const rateLimit = await checkPinRateLimitDb(supabase, token, ip);
    if (!rateLimit.allowed) {
      const headers: Record<string, string> = {};
      if (rateLimit.retryAfterMs) {
        headers["Retry-After"] = String(Math.ceil((rateLimit.retryAfterMs || 0) / 1000));
      }
      return NextResponse.json(
        { status: "error", message: "Too many attempts. Please try again later." },
        { status: 429, headers },
      );
    }

    const { data: recipient, error: fetchError } = await supabase
      .from("recipients")
      .select(`
        id, delivery_id, pin_hash, encrypted_data, nonce, salt, iterations,
        status, failed_attempts, view_count, opened_at,
        deliveries (
          id, title, content_type, status, max_views, expires_at, burn_after_reading, release_at, renewal_deadline
        )
      `)
      .eq("url_token", token)
      .single();

    const rawDelivery = recipient?.deliveries;
    const delivery = Array.isArray(rawDelivery) ? rawDelivery[0] : rawDelivery;

    if (fetchError || !recipient || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid link" },
        { status: 404 },
      );
    }

    const recipientId = recipient.id;

    if (delivery.status === "expired" || delivery.status === "revoked" || delivery.status === "destroyed" || delivery.status === "locked") {
      return NextResponse.json(
        { status: "error", message: "This link is no longer valid" },
        { status: 410 },
      );
    }

    if (recipient.status === "revoked" || recipient.status === "locked") {
      return NextResponse.json(
        { status: "error", message: "This link is no longer valid" },
        { status: 410 },
      );
    }

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

    if (deadManTriggered(delivery.renewal_deadline)) {
      await destroyForDeadManSwitch(supabase, delivery.id);
      await wipeRecipientCopies(supabase, delivery.id);
      await logDeadManSwitch(supabase, delivery.id, ip);
      return NextResponse.json(
        { status: "error", message: "This link is no longer valid" },
        { status: 410 },
      );
    }

    if (delivery.expires_at) {
      const expiry = new Date(delivery.expires_at);
      if (expiry < new Date()) {
        await supabase
          .from("deliveries")
          .update({ status: "expired" })
          .eq("id", delivery.id);

        await supabase
          .from("recipients")
          .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
          .eq("id", recipientId);

        await supabase.from("access_events").insert({
          delivery_id: delivery.id,
          recipient_id: recipientId,
          event_type: "expired",
          metadata: { ip },
        });

        return NextResponse.json(
          { status: "error", message: "This link is no longer valid" },
          { status: 410 },
        );
      }
    }

    if (recipient.encrypted_data == null) {
      return NextResponse.json(
        { status: "error", message: "This link is no longer valid" },
        { status: 410 },
      );
    }

    const isValid = await validatePIN(pin, recipient.pin_hash);

    if (!isValid) {
      // Atomic failed-attempt counting. Preferred path: a single-statement
      // SQL increment (migration 006) which is contention-proof. Fallback:
      // optimistic CAS on the previous value if the RPC is not deployed yet.
      let newFailedAttempts = 0;
      let counted = false;

      const { data: rpcCount, error: rpcError } = await supabase.rpc(
        "record_failed_attempt",
        { p_recipient_id: recipientId }
      );
      if (!rpcError && typeof rpcCount === "number") {
        newFailedAttempts = rpcCount;
        counted = true;
      } else {
        for (let attempt = 0; attempt < 5 && !counted; attempt++) {
          const { data: cur } = await supabase
            .from("recipients")
            .select("failed_attempts")
            .eq("id", recipientId)
            .single();
          const prev = (cur?.failed_attempts as number) ?? 0;
          newFailedAttempts = prev + 1;
          const { data: incRows, error: incError } = await supabase
            .from("recipients")
            .update({ failed_attempts: newFailedAttempts })
            .eq("id", recipientId)
            .eq("failed_attempts", prev)
            .select("failed_attempts");
          if (incError) {
            console.error("Failed to increment failed_attempts:", incError);
          }
          if (incRows && incRows.length > 0) counted = true;
        }
      }
      const remaining = Math.max(0, MAX_PIN_ATTEMPTS - newFailedAttempts);

      if (counted && newFailedAttempts >= MAX_PIN_ATTEMPTS) {
        await supabase
          .from("recipients")
          .update({
            status: "locked",
            encrypted_data: null,
            nonce: null,
            salt: null,
            pin_hash: null,
          })
          .eq("id", recipientId);

        await supabase.from("access_events").insert({
          delivery_id: delivery.id,
          recipient_id: recipientId,
          event_type: "locked",
          metadata: { reason: "max_failed_attempts", ip },
        });

        await supabase.from("access_events").insert({
          delivery_id: delivery.id,
          recipient_id: recipientId,
          event_type: "destroyed",
          metadata: { reason: "pin_lockout", ip },
        });

        return NextResponse.json(
          { status: "error", message: "Too many wrong PINs. This copy has been destroyed." },
          { status: 423 },
        );
      }

      await supabase.from("access_events").insert({
        delivery_id: delivery.id,
        recipient_id: recipientId,
        event_type: "pin_failed",
        metadata: { ip, remaining },
      });

      return NextResponse.json(
        { status: "error", message: "Invalid PIN", remainingAttempts: remaining },
        { status: 403 },
      );
    }

    const { data: consumedRecipient, error: consumeError } = await supabase
      .rpc("consume_recipient_secret", {
        p_recipient_id: recipientId,
        p_delivery_id: delivery.id,
        p_burn_after_reading: delivery.burn_after_reading,
        p_max_views: delivery.max_views,
        p_current_view_count: recipient.view_count,
        p_ip: ip,
      });

    if (consumeError) {
      console.error("Consume secret error:", consumeError);
      return NextResponse.json(
        { status: "error", message: "Internal server error" },
        { status: 500 },
      );
    }

    if (!consumedRecipient || consumedRecipient.length === 0) {
      return NextResponse.json(
        { status: "error", message: "This link is no longer valid" },
        { status: 410 },
      );
    }

    const result = consumedRecipient[0] as Record<string, unknown>;

    // The RPC signals policy failures via an `error` key in the returned row
    // (e.g. concurrent consumers, already-consumed, locked). Map them to real
    // status codes instead of returning 200 with an empty payload.
    if (result && typeof result === "object" && result.error) {
      const reason = String(result.error);
      const statusByReason: Record<string, number> = {
        concurrent_access: 409,
        already_consumed: 410,
        delivery_invalid: 410,
        locked: 423,
        not_found: 404,
        delivery_not_found: 404,
      };
      const httpStatus = statusByReason[reason] ?? 410;
      const message =
        reason === "concurrent_access"
          ? "This drop is being opened by another request. Please try again."
          : "This link is no longer valid";
      return NextResponse.json(
        { status: "error", message },
        { status: httpStatus },
      );
    }

    if (result.destroyed) {
      return NextResponse.json({
        status: "ok",
        data: {
          encryptedData: result.encrypted_data,
          nonce: result.nonce,
          salt: result.salt,
          iterations: result.iterations,
          contentType: delivery.content_type,
          title: delivery.title,
          burnAfterReading: delivery.burn_after_reading,
        },
        destroyed: true,
        message: "This was a one-time delivery. The secret has been destroyed.",
      });
    }

    return NextResponse.json({
      status: "ok",
      data: {
        encryptedData: result.encrypted_data,
        nonce: result.nonce,
        salt: result.salt,
        iterations: result.iterations,
        contentType: delivery.content_type,
        title: delivery.title,
        burnAfterReading: delivery.burn_after_reading,
      },
      destroyed: false,
    });
  } catch (error) {
    console.error("Access recipient error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}