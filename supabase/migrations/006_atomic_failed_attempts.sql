-- VaultDrop: Atomic failed-attempt counters
-- Fixes H-01: concurrent wrong-PIN requests could lose increments when using
-- read-modify-write (or optimistic CAS over HTTP). A single self-referencing
-- UPDATE is atomic in PostgreSQL regardless of contention.
--
-- Additive only: creates two functions, touches no tables/policies.
-- Safe to apply while the app is running.

-- Returns the NEW failed_attempts value after an atomic increment.
create or replace function public.record_failed_attempt(p_recipient_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update recipients
     set failed_attempts = failed_attempts + 1
   where id = p_recipient_id
   returning failed_attempts;
$$;

create or replace function public.record_failed_attempt_delivery(p_delivery_id text)
returns integer
language sql
security definer
set search_path = public
as $$
  update deliveries
     set failed_attempts = failed_attempts + 1
   where id = p_delivery_id
   returning failed_attempts;
$$;

-- Least privilege: only the server (service_role) needs these.
revoke execute on function public.record_failed_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.record_failed_attempt_delivery(text) from public, anon, authenticated;
grant execute on function public.record_failed_attempt(uuid) to service_role;
grant execute on function public.record_failed_attempt_delivery(text) to service_role;
