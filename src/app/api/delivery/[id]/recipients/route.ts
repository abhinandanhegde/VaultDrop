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

    const { data: delivery, error: delError } = await supabase
      .from("deliveries")
      .select("id, creator_token, status")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (delError || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    const { data: recipients, error } = await supabase
      .from("recipients")
      .select("id, name, url_token, status, failed_attempts, view_count, opened_at, revoked_at, created_at")
      .eq("delivery_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Fetch recipients error:", error);
      return NextResponse.json(
        { status: "error", message: "Failed to fetch recipients" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: {
        id: delivery.id,
        status: delivery.status,
        recipients: (recipients || []).map((r) => ({
          id: r.id,
          name: r.name,
          urlToken: r.url_token,
          status: r.status,
          failedAttempts: r.failed_attempts,
          viewCount: r.view_count,
          openedAt: r.opened_at,
          revokedAt: r.revoked_at,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("Get recipients error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}