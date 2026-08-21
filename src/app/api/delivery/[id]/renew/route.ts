import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { creatorToken } = body;

    if (!creatorToken || typeof creatorToken !== "string") {
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

    const { data: delivery, error } = await supabase
      .from("deliveries")
      .select("id, creator_token, status, renewal_window_minutes")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (error || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    if (delivery.status !== "active") {
      return NextResponse.json(
        { status: "error", message: "This delivery is no longer active" },
        { status: 410 },
      );
    }

    if (delivery.renewal_window_minutes == null) {
      return NextResponse.json(
        { status: "error", message: "This drop does not have a renewal deadline" },
        { status: 400 },
      );
    }

    const window = delivery.renewal_window_minutes;
    const nextDeadline = new Date(Date.now() + window * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("deliveries")
      .update({ renewal_deadline: nextDeadline })
      .eq("id", id);

    if (updateError) {
      console.error("Renew error:", updateError);
      return NextResponse.json(
        { status: "error", message: "Failed to renew" },
        { status: 500 },
      );
    }

    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "renewed",
      metadata: { window_minutes: window, next_deadline: nextDeadline },
    });

    return NextResponse.json({
      status: "ok",
      renewalDeadline: nextDeadline,
      message: `Renewed. Next self-destruct in ${window} minute${window === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    console.error("Renew error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}