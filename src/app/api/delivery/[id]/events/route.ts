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

    // Verify creator token
    const { data: delivery, error: verifyError } = await supabase
      .from("deliveries")
      .select("id")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (verifyError || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    // Fetch access events
    const { data: events, error: eventsError } = await supabase
      .from("access_events")
      .select("id, delivery_id, event_type, event_time, metadata")
      .eq("delivery_id", id)
      .order("event_time", { ascending: true })
      .limit(200);

    if (eventsError) {
      console.error("Events fetch error:", eventsError);
      return NextResponse.json(
        { status: "error", message: "Failed to fetch events" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "ok",
      data: (events || []).map((e: Record<string, unknown>) => ({
        id: e.id,
        eventType: e.event_type,
        eventTime: e.event_time,
        metadata: e.metadata,
      })),
    });
  } catch (error) {
    console.error("Get events error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}
