-- VaultDrop: Client-side PIN transport hashing
--
-- Fixes the zero-knowledge gap where the raw PIN traveled to the server on
-- create AND access requests. Combined with the persisted salt + iteration
-- count, anyone with DB read access could derive the AES key themselves.
-- Clients now send SHA-256(pin) (hex) as the transport value; the server
-- never learns the raw PIN and only ever bcrypt-compares opaque strings.
--
-- Also makes check_pin_rate_limit dual-mode so the legacy delivery-id route
-- gets the same DB-backed sliding-window throttle as the recipient route.
--
-- Additive / backwards compatible:
--   * pin_scheme defaults to 'raw' so pre-existing drops keep working.
--   * New drops whose clients hash pins are written with pin_scheme='sha256'.
-- Safe to apply while the app is running.

alter table deliveries add column if not exists pin_scheme text not null default 'raw';

-- ============================================
-- PIN RATE LIMIT CHECK (atomic, server-side, dual-mode)
-- p_token may be either a recipient url_token OR a legacy delivery id.
-- ============================================
create or replace function check_pin_rate_limit(
  p_token text,
  p_ip text,
  p_window_start timestamptz,
  p_max_attempts int
) returns jsonb language plpgsql as $$
declare
  attempt_count int;
  oldest_attempt timestamptz;
  resolved_delivery_id text;
begin
  -- Resolve the drop this attempt targets: prefer a url_token match,
  -- otherwise treat the value as a direct delivery id (legacy endpoint).
  select coalesce(
    (select delivery_id from recipients where url_token = p_token limit 1),
    case when exists (select 1 from deliveries where id = p_token) then p_token end
  )
  into resolved_delivery_id;

  if resolved_delivery_id is null then
    return jsonb_build_object('allowed', true);
  end if;

  -- Count attempts in the sliding window
  select count(*), min(event_time)
  into attempt_count, oldest_attempt
  from access_events
  where metadata->>'ip' = p_ip
    and event_type = 'pin_failed'
    and event_time >= p_window_start
    and delivery_id = resolved_delivery_id;

  if attempt_count >= p_max_attempts then
    return jsonb_build_object(
      'allowed', false,
      'retryAfterMs', greatest(0, extract(epoch from (oldest_attempt + interval '15 minutes' - now())) * 1000)
    );
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

grant execute on function check_pin_rate_limit to anon, authenticated, service_role;
