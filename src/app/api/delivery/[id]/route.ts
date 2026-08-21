import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!id || typeof id !== "string" || id.length < 16) {
      return NextResponse.json(
        { status: "error", message: "Invalid delivery ID" },
        { status: 400 },
      );
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from("deliveries")
      .select("id, title, content_type, status, max_views, expires_at, created_at, accessed_at, destroyed_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { status: "error", message: "Delivery not found or expired" },
        { status: 404 },
      );
    }

    // Check if expired
    if (data.status === "expired") {
      return NextResponse.json({
        status: "ok",
        data: {
          id: data.id,
          status: "expired",
          message: "This delivery has expired",
        },
      });
    }

    return NextResponse.json({
      status: "ok",
      data: {
        id: data.id,
        title: data.title,
        contentType: data.content_type,
        status: data.status,
        maxViews: data.max_views,
        expiresAt: data.expires_at,
        createdAt: data.created_at,
        accessedAt: data.accessed_at,
        destroyedAt: data.destroyed_at,
      },
    });
  } catch (error) {
    console.error("Get delivery error:", error);
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
