import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    if (!token || typeof token !== "string" || token.length < 16) {
      return NextResponse.json(
        { status: "error", message: "Invalid link" },
        { status: 400 },
      );
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from("recipients")
      .select(`
        id, name, status, view_count, opened_at, created_at,
        deliveries (
          id, title, content_type, status, max_views, expires_at, burn_after_reading, release_at, renewal_deadline
        )
      `)
      .eq("url_token", token)
      .single();

    const rawDelivery = data?.deliveries;
    const delivery = Array.isArray(rawDelivery) ? rawDelivery[0] : rawDelivery;

    if (error || !data || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Link not found" },
        { status: 404 },
      );
    }

    if (delivery.status === "expired") {
      return NextResponse.json({
        status: "ok",
        data: { state: "expired", message: "This delivery has expired" },
      });
    }

    if (delivery.status === "revoked") {
      return NextResponse.json({
        status: "ok",
        data: { state: "revoked", message: "This delivery was revoked by the creator" },
      });
    }

    if (delivery.status === "destroyed") {
      return NextResponse.json({
        status: "ok",
        data: { state: "destroyed", message: "This secret is no longer available" },
      });
    }

    // Dead Man's Switch: deadline passed without renewal → self-destructed
    if (delivery.renewal_deadline && new Date(delivery.renewal_deadline) <= new Date()) {
      return NextResponse.json({
        status: "ok",
        data: { state: "deadman", message: "The sender stopped renewing this drop. It has self-destructed." },
      });
    }

    if (delivery.status === "locked") {
      return NextResponse.json({
        status: "ok",
        data: { state: "locked", message: "This delivery is locked" },
      });
    }

    let state = data.status; // pending | opened | revoked | locked

    // Time-lock: not yet released
    if (delivery.release_at && new Date(delivery.release_at) > new Date()) {
      return NextResponse.json({
        status: "ok",
        data: {
          state: "not_released",
          title: delivery.title,
          contentType: delivery.content_type,
          releaseAt: delivery.release_at,
          recipientStatus: data.status,
          deliveryStatus: delivery.status,
          name: data.name,
          burnAfterReading: delivery.burn_after_reading,
        },
      });
    }

    // A link that already burned reads as "no longer available"
    if (data.status === "opened" && data.view_count > 0 && delivery.burn_after_reading) {
      state = "destroyed";
    }

    return NextResponse.json({
      status: "ok",
      data: {
        id: data.id,
        name: data.name,
        state,
        recipientStatus: data.status,
        title: delivery.title,
        contentType: delivery.content_type,
        deliveryStatus: delivery.status,
        maxViews: delivery.max_views,
        expiresAt: delivery.expires_at,
        releaseAt: delivery.release_at,
        burnAfterReading: delivery.burn_after_reading,
        createdAt: data.created_at,
        openedAt: data.opened_at,
      },
    });
  } catch (error) {
    console.error("Get recipient error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { status: "error", message: "Method not allowed" },
    { status: 405 },
  );
}