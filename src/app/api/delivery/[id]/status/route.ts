import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const creatorToken = searchParams.get("token");

    if (!creatorToken) {
      return NextResponse.json(
        { status: "error", message: "Missing creator token" },
        { status: 401 },
      );
    }

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { status: "error", message: "Invalid delivery ID" },
        { status: 400 },
      );
    }

    const supabase = createClient();

    // Fetch full status (with creator token verification)
    const { data: delivery, error } = await supabase
      .from("deliveries")
      .select("id, title, content_type, status, max_views, expires_at, release_at, renewal_deadline, renewal_window_minutes, burn_after_reading, created_at, accessed_at, destroyed_at, view_count, failed_attempts")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (error || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: {
        id: delivery.id,
        title: delivery.title,
        contentType: delivery.content_type,
        status: delivery.status,
        maxViews: delivery.max_views,
        expiresAt: delivery.expires_at,
        releaseAt: delivery.release_at,
        renewalDeadline: delivery.renewal_deadline,
        renewalWindowMinutes: delivery.renewal_window_minutes,
        burnAfterReading: delivery.burn_after_reading,
        createdAt: delivery.created_at,
        accessedAt: delivery.accessed_at,
        destroyedAt: delivery.destroyed_at,
        viewCount: delivery.view_count,
        failedAttempts: delivery.failed_attempts,
      },
    });
  } catch (error) {
    console.error("Get delivery status error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}
