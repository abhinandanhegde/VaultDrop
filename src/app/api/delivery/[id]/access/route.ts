import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePIN } from "@/lib/bcrypt";
import { MAX_PIN_ATTEMPTS } from "@/lib/crypto";
import { deadManTriggered, destroyForDeadManSwitch, logDeadManSwitch } from "@/lib/deadman";
import { createRateLimiter, clientIp } from "@/lib/ratelimit";

const checkPinRateLimit = createRateLimiter(5, 15 * 60 * 1000).allow;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { pin } = body;

    if (!pin || typeof pin !== "string" || pin.length !== 6) {
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

    // Rate limit PIN attempts
    const ip = clientIp(request);
    const rateKey = `${id}:${ip}`;
    if (!checkPinRateLimit(rateKey)) {
      return NextResponse.json(
        { status: "error", message: "Too many attempts. Please wait 15 minutes." },
        { status: 429 },
      );
    }

    const supabase = createClient();

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

    // Validate PIN
    const isValid = await validatePIN(pin, delivery.pin_hash);

    if (!isValid) {
      const newFailedAttempts = (delivery.failed_attempts || 0) + 1;
      const remaining = MAX_PIN_ATTEMPTS - newFailedAttempts;

      // Lock the delivery if max attempts exceeded
      if (newFailedAttempts >= MAX_PIN_ATTEMPTS) {
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

      // Increment failed attempts
      await supabase
        .from("deliveries")
        .update({ failed_attempts: newFailedAttempts })
        .eq("id", id);

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
    // Check if expired
    if (delivery.expires_at) {
      const expiry = new Date(delivery.expires_at);
      if (expiry < new Date()) {
        await supabase
          .from("deliveries")
          .update({ status: "expired" })
          .eq("id", id);

        await supabase.from("access_events").insert({
          delivery_id: id,
          event_type: "expired",
          metadata: { ip },
        });

        // Delete encrypted data
        await supabase
          .from("deliveries")
          .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
          .eq("id", id);

        return NextResponse.json(
          { status: "error", message: "This delivery has expired" },
          { status: 410 },
        );
      }
    }

    // Log successful PIN validation
    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "pin_validated",
      metadata: { ip },
    });

    // Check view count / max views
    const newViewCount = (delivery.view_count || 0) + 1;
    const isMaxReached = delivery.max_views > 0 && newViewCount >= delivery.max_views;
    const shouldBurn = delivery.burn_after_reading || isMaxReached;

    // Update view count
    const statusUpdate: Record<string, unknown> = {
      view_count: newViewCount,
      accessed_at: new Date().toISOString(),
    };

    if (shouldBurn) {
      statusUpdate.status = "destroyed";
      statusUpdate.destroyed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("deliveries")
      .update(statusUpdate)
      .eq("id", id);

    if (updateError) {
      console.error("Failed to update delivery status:", updateError);
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

      // Delete encrypted data (zero-knowledge cleanup)
      await supabase
        .from("deliveries")
        .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
        .eq("id", id);
    }

    // For multi-recipient deliveries, the delivery-level encrypted_data is null.
    // Recipients must use the /r/[token] endpoint instead.
    if (!delivery.encrypted_data || !delivery.nonce || !delivery.salt) {
      return NextResponse.json(
        { status: "error", message: "This is a multi-recipient delivery. Please use the recipient-specific link." },
        { status: 400 },
      );
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
