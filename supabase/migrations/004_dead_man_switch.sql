-- VaultDrop: Dead Man's Switch
-- Lets the creator set a renewal deadline. If the creator does not "renew"
-- before the deadline, the drop self-destructs (all ciphertext wiped).
-- The secret dies instead of falling into wrong hands if the sender goes silent.

alter table deliveries add column if not exists renewal_deadline timestamptz;
alter table deliveries add column if not exists renewal_window_minutes integer;

create index if not exists idx_deliveries_renewal_deadline on deliveries(renewal_deadline)
  where renewal_deadline is not null and status = 'active';