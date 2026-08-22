import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { removeEncryptedObject } from "@/lib/storage";

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

    // Verify creator token
    const { error: verifyError } = await supabase
      .from("deliveries")
      .select("id")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (verifyError) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    // Log deletion BEFORE deleting (the FK cascade removes the row's events on delete)
    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "destroyed",
      metadata: { reason: "creator_deleted" },
    });

    // Capture the blob reference before the row disappears
    const { data: pathRow } = await supabase
      .from("deliveries")
      .select("storage_path")
      .eq("id", id)
      .single();

    // Permanently delete
    const { error: deleteError } = await supabase
      .from("deliveries")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Delete error:", deleteError);
      return NextResponse.json(
        { status: "error", message: "Failed to delete delivery" },
        { status: 500 },
      );
    }

    if (pathRow?.storage_path) {
      await removeEncryptedObject(supabase, pathRow.storage_path);
    }

    return NextResponse.json({
      status: "ok",
      message: "Delivery permanently deleted",
    });
  } catch (error) {
    console.error("Delete delivery error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}
