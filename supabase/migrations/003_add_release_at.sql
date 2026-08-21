-- VaultDrop: Time-lock release
-- Lets the creator schedule when a drop becomes readable.
-- Before release_at, the ciphertext is never served — even with the correct PIN.

alter table deliveries add column if not exists release_at timestamptz;

create index if not exists idx_deliveries_release_at on deliveries(release_at);