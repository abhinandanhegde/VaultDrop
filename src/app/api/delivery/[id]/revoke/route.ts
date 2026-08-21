import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { wipeRecipientCopies } from "@/lib/deadman";

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
    const { data: delivery, error: fetchError } = await supabase
      .from("deliveries")
      .select("id, status")
      .eq("id", id)
      .eq("creator_token", creatorToken)
      .single();

    if (fetchError || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    // Only active deliveries can be revoked
    if (delivery.status !== "active") {
      return NextResponse.json(
        { status: "ok", message: `Delivery is already ${delivery.status}` },
        { status: 200 },
      );
    }

    // Revoke the delivery — delete encrypted data
    const { error: revokeError } = await supabase
      .from("deliveries")
      .update({
        status: "revoked",
        encrypted_data: null,
        nonce: null,
        salt: null,
        pin_hash: null,
        destroyed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (revokeError) {
      console.error("Revoke error:", revokeError);
      return NextResponse.json(
        { status: "error", message: "Failed to revoke delivery" },
        { status: 500 },
      );
    }

    // Wipe every per-recipient copy so no ciphertext lingers at rest
    await wipeRecipientCopies(supabase, id);

    // Log the revocation
    await supabase.from("access_events").insert({
      delivery_id: id,
      event_type: "revoked",
      metadata: {},
    });

    return NextResponse.json({
      status: "ok",
      message: "Delivery revoked successfully. Encrypted data has been deleted.",
    });
  } catch (error) {
    console.error("Revoke delivery error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}
