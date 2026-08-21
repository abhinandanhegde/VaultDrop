import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  try {
    // Validate purge secret (constant-time comparison)
    const { searchParams } = new URL(request.url);
    const purgeSecret = searchParams.get("secret") || request.headers.get("x-purge-secret");
    const expected = process.env.PURGE_SECRET;

    if (!purgeSecret || !expected || !timingSafeEqual(purgeSecret, expected)) {
      return NextResponse.json(
        { status: "error", message: "Unauthorized" },
        { status: 401 },
      );
    }

    const supabase = createClient();
    const now = new Date().toISOString();
    const errors: string[] = [];

// 1. Mark deliveries expired: past expires_at, or dead-man's-switch deadline passed
    //    (a drop whose sender stopped renewing self-destructs even without anyone accessing it).
    const { data: expired, error: expireError } = await supabase
      .from("deliveries")
      .update({
        status: "expired",
        encrypted_data: null,
        nonce: null,
        salt: null,
        pin_hash: null,
        destroyed_at: now,
      })
      .eq("status", "active")
      .or(`expires_at.lte.${now},renewal_deadline.lte.${now}`)
      .select("id");

    if (expireError) {
      errors.push(`expire: ${expireError.message}`);
    }

    // 2. Wipe recipient copies belonging to expired/destroyed/revoked/locked deliveries
    //    so no ciphertext lingers under an already-dead drop.
    const { error: wipeError } = await supabase
      .from("recipients")
      .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
      .in("delivery_id", (expired || []).map((d: { id: string }) => d.id));

    if (wipeError) {
      errors.push(`wipe: ${wipeError.message}`);
    }

    // 3. Delete fully destroyed deliveries older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deleted, error: cleanupError } = await supabase
      .from("deliveries")
      .delete()
      .or(`and(status.eq.expired,destroyed_at.lte.${thirtyDaysAgo}),and(status.eq.destroyed,destroyed_at.lte.${thirtyDaysAgo}),and(status.eq.revoked,destroyed_at.lte.${thirtyDaysAgo})`)
      .select("id");

    if (cleanupError) {
      errors.push(`cleanup: ${cleanupError.message}`);
    }

    // 4. Clean up old access events (older than 30 days)
    const { error: eventsCleanupError } = await supabase
      .from("access_events")
      .delete()
      .lt("event_time", thirtyDaysAgo);

    if (eventsCleanupError) {
      errors.push(`events: ${eventsCleanupError.message}`);
    }

    return NextResponse.json({
      status: "ok",
      message: `Purge complete. Expired: ${expired?.length || 0}, deleted: ${deleted?.length || 0}`,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("Purge error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}