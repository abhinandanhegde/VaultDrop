-- VaultDrop: Atomic operations for secure secret consumption
-- Adds PostgreSQL functions for atomic PIN rate limiting and secret consumption

-- ============================================
-- PIN RATE LIMIT CHECK (atomic, server-side)
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
begin
  -- Count attempts in the sliding window
  select count(*), min(event_time)
  into attempt_count, oldest_attempt
  from access_events
  where metadata->>'ip' = p_ip
    and event_type = 'pin_failed'
    and event_time >= p_window_start
    and delivery_id in (
      select id from deliveries where id in (
        select delivery_id from recipients where url_token = p_token
      )
    );

  if attempt_count >= p_max_attempts then
    return jsonb_build_object(
      'allowed', false,
      'retryAfterMs', greatest(0, extract(epoch from (oldest_attempt + interval '15 minutes' - now())) * 1000)
    );
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

-- ============================================
-- ATOMIC SECRET CONSUMPTION
-- Uses advisory lock to prevent race conditions
-- Returns the secret data only if consumption succeeds atomically
-- ============================================
create or replace function consume_recipient_secret(
  p_recipient_id uuid,
  p_delivery_id text,
  p_burn_after_reading boolean,
  p_max_views int,
  p_current_view_count int,
  p_ip text
) returns setof jsonb language plpgsql as $$
declare
  lock_result boolean;
  recipient_record recipients%rowtype;
  delivery_record deliveries%rowtype;
  new_view_count int;
  should_burn boolean;
  result jsonb;
begin
  -- Acquire advisory lock for this recipient to prevent concurrent consumption
  lock_result := pg_try_advisory_xact_lock(hashtext(p_recipient_id::text));
  if not lock_result then
    return query select jsonb_build_object('error', 'concurrent_access');
  end if;

  -- Fetch current state within the lock
  select * into recipient_record from recipients where id = p_recipient_id for update;
  select * into delivery_record from deliveries where id = p_delivery_id for update;

  -- Verify recipient exists and is accessible
  if recipient_record is null then
    return query select jsonb_build_object('error', 'not_found');
  end if;

  if recipient_record.encrypted_data is null then
    return query select jsonb_build_object('error', 'already_consumed');
  end if;

  if recipient_record.status in ('revoked', 'locked') then
    return query select jsonb_build_object('error', 'locked');
  end if;

  if delivery_record is null then
    return query select jsonb_build_object('error', 'delivery_not_found');
  end if;

  if delivery_record.status in ('expired', 'revoked', 'destroyed', 'locked') then
    return query select jsonb_build_object('error', 'delivery_invalid');
  end if;

  -- Calculate new view count and burn decision
  new_view_count := coalesce(recipient_record.view_count, 0) + 1;
  should_burn := p_burn_after_reading or (p_max_views > 0 and new_view_count >= p_max_views);

  -- Update recipient atomically
  update recipients
  set
    view_count = new_view_count,
    failed_attempts = 0,
    opened_at = coalesce(recipient_record.opened_at, now()),
    status = case when should_burn then 'opened' else 'opened' end,
    encrypted_data = case when should_burn then null else encrypted_data end,
    nonce = case when should_burn then null else nonce end,
    salt = case when should_burn then null else salt end,
    pin_hash = case when should_burn then null else pin_hash end
  where id = p_recipient_id;

  -- Update delivery view count
  update deliveries
  set
    view_count = coalesce(view_count, 0) + 1,
    accessed_at = coalesce(accessed_at, now()),
    status = case
      when should_burn and (select count(*) from recipients where delivery_id = p_delivery_id and encrypted_data is not null) = 0
      then 'destroyed'
      else status
    end,
    destroyed_at = case
      when should_burn and (select count(*) from recipients where delivery_id = p_delivery_id and encrypted_data is not null) = 0
      then now()
      else destroyed_at
    end
  where id = p_delivery_id;

  -- Log access event
  insert into access_events (delivery_id, recipient_id, event_type, metadata)
  values (p_delivery_id, p_recipient_id, 'accessed', jsonb_build_object('ip', p_ip, 'view_count', new_view_count));

  -- Log PIN validation event
  insert into access_events (delivery_id, recipient_id, event_type, metadata)
  values (p_delivery_id, p_recipient_id, 'pin_validated', jsonb_build_object('ip', p_ip));

  -- If burning, log destruction event
  if should_burn then
    insert into access_events (delivery_id, recipient_id, event_type, metadata)
    values (p_delivery_id, p_recipient_id, 'destroyed', jsonb_build_object('reason', 'burn_after_reading', 'view_count', new_view_count));
  end if;

  -- Return the secret data (only if not burned, or if this is the burning access)
  result := jsonb_build_object(
    'encrypted_data', recipient_record.encrypted_data,
    'nonce', recipient_record.nonce,
    'salt', recipient_record.salt,
    'iterations', recipient_record.iterations,
    'destroyed', should_burn
  );

  return query select result;
end;
$$;

-- ============================================
-- HELPER: Hash text for advisory lock
-- ============================================
create or replace function hashtext(text) returns int language sql immutable as $$
  select ('x' || substr(md5($1), 1, 8))::bit(32)::int;
$$;

-- Grant execute permissions to the API role
grant execute on function check_pin_rate_limit to anon, authenticated, service_role;
grant execute on function consume_recipient_secret to anon, authenticated, service_role;
grant execute on function hashtext to anon, authenticated, service_role;