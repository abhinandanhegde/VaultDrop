import type { SupabaseClient } from "@supabase/supabase-js";

// Shared logic for enforcing a Dead Man's Switch.
// If renewal_deadline has passed, the drop self-destructs: all ciphertext and
// PIN hashes are wiped and the delivery is marked destroyed.

export function deadManTriggered(renewalDeadline: string | null | undefined, now = Date.now()): boolean {
  if (!renewalDeadline) return false;
  return new Date(renewalDeadline).getTime() <= now;
}

export function destroyForDeadManSwitch(
  supabase: SupabaseClient,
  deliveryId: string,
) {
  const now = new Date().toISOString();
  return supabase.from("deliveries").update({
    status: "destroyed",
    destroyed_at: now,
    encrypted_data: null,
    nonce: null,
    salt: null,
    pin_hash: null,
    renewal_deadline: null,
  }).eq("id", deliveryId);
}

export function wipeRecipientCopies(supabase: SupabaseClient, deliveryId: string) {
  return supabase
    .from("recipients")
    .update({ encrypted_data: null, nonce: null, salt: null, pin_hash: null })
    .eq("delivery_id", deliveryId);
}

export function logDeadManSwitch(supabase: SupabaseClient, deliveryId: string, ip: string) {
  return supabase.from("access_events").insert({
    delivery_id: deliveryId,
    event_type: "destroyed",
    metadata: { reason: "dead_man_switch", ip },
  });
}