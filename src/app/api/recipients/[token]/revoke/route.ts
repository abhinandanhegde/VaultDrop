import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { removeDeliveryFileIfFullyConsumed } from "@/lib/storage";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { creatorToken } = body;

    if (!creatorToken || typeof creatorToken !== "string") {
      return NextResponse.json(
        { status: "error", message: "Missing creator token" },
        { status: 401 },
      );
    }

    if (!token || typeof token !== "string" || token.length < 16) {
      return NextResponse.json(
        { status: "error", message: "Invalid recipient link" },
        { status: 400 },
      );
    }

    const supabase = createClient();

    const { data: recipient, error: recError } = await supabase
      .from("recipients")
      .select("id, delivery_id, status")
      .eq("url_token", token)
      .single();

    if (recError || !recipient) {
      return NextResponse.json(
        { status: "error", message: "Recipient not found" },
        { status: 404 },
      );
    }

    // Verify the caller is the creator of this delivery
    const { data: delivery, error: delError } = await supabase
      .from("deliveries")
      .select("id, creator_token, status")
      .eq("id", recipient.delivery_id)
      .eq("creator_token", creatorToken)
      .single();

    if (delError || !delivery) {
      return NextResponse.json(
        { status: "error", message: "Invalid creator token or delivery not found" },
        { status: 403 },
      );
    }

    if (recipient.status === "revoked") {
      return NextResponse.json({
        status: "ok",
        message: "This recipient was already revoked",
      });
    }

    if (recipient.status === "opened") {
      return NextResponse.json(
        { status: "error", message: "Cannot revoke a recipient who already opened the secret" },
        { status: 409 },
      );
    }

    // Revoke this recipient — wipe their copy of the ciphertext
    const { error: revokeError } = await supabase
      .from("recipients")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        encrypted_data: null,
        nonce: null,
        salt: null,
        pin_hash: null,
      })
      .eq("id", recipient.id);

    if (revokeError) {
      console.error("Revoke recipient error:", revokeError);
      return NextResponse.json(
        { status: "error", message: "Failed to revoke recipient" },
        { status: 500 },
      );
    }

    await supabase.from("access_events").insert({
      delivery_id: recipient.delivery_id,
      recipient_id: recipient.id,
      event_type: "revoked",
      metadata: { scope: "recipient" },
    });

    // If this was the last consumable copy, the shared encrypted blob goes too.
    await removeDeliveryFileIfFullyConsumed(supabase, recipient.delivery_id);

    return NextResponse.json({
      status: "ok",
      message: "Recipient revoked. Their copy of the secret has been deleted.",
    });
  } catch (error) {
    console.error("Revoke recipient error:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}