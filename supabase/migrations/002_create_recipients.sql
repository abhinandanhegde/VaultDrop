-- VaultDrop: Multi-recipient delivery
-- Adds per-recipient links/PINs and courier-style tracking

-- ============================================
-- RECIPIENTS TABLE
-- Each recipient gets their own shareable link + PIN + status.
-- The secret is encrypted once per recipient in the browser,
-- so each recipient row carries its own ciphertext.
-- ============================================
create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null references deliveries(id) on delete cascade,
  name text,                            -- recipient label ("Team lead", "Alice", ...)
  url_token text not null unique,       -- compact 22-char token used in the shareable link
  pin_hash text,                        -- bcrypt hash of this recipient's PIN
  encrypted_data text,                  -- per-recipient AES-256-GCM ciphertext
  nonce text,
  salt text,
  iterations integer not null default 600000,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'opened', 'revoked', 'locked')),
  failed_attempts integer not null default 0,
  view_count integer not null default 0,
  opened_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table recipients enable row level security;

create index if not exists idx_recipients_delivery_id on recipients(delivery_id);
create index if not exists idx_recipients_url_token on recipients(url_token);

-- Attribute access events to a specific recipient
alter table access_events add column if not exists recipient_id uuid references recipients(id) on delete set null;

create index if not exists idx_access_events_recipient_id on access_events(recipient_id);