-- VaultDrop: Encrypted file delivery (migration 008)
-- Adds file metadata columns to deliveries and creates the PRIVATE Storage
-- bucket that holds encrypted file blobs.
--
-- Security model (unchanged from text secrets):
--   * Browsers encrypt files locally with AES-256-GCM before upload.
--   * This bucket stores ONLY opaque ciphertext, always uploaded as
--     application/octet-stream. The server never sees plaintext or keys.
--   * The bucket is private and has NO storage.objects policies: anon and
--     authenticated roles are denied by default; only the service role
--     (used exclusively by VaultDrop API routes) can touch objects.

-- ============================================
-- FILE METADATA ON DELIVERIES
-- kind='text' rows behave exactly as before. kind='file' rows carry the
-- encrypted blob reference; per-recipient wrapped content keys live in the
-- existing recipients.encrypted_data/nonce/salt/iterations columns, so all
-- PIN/policy/view/burn logic applies unchanged.
-- ============================================
alter table deliveries
  add column if not exists kind text not null default 'text',
  add column if not exists file_name text,
  add column if not exists file_mime text,
  add column if not exists file_size bigint,
  add column if not exists storage_path text,
  add column if not exists file_nonce text,
  add column if not exists enc_version integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliveries_kind_check') then
    alter table deliveries add constraint deliveries_kind_check check (kind in ('text', 'file'));
  end if;
end $$;

create index if not exists idx_deliveries_storage_path
  on deliveries(storage_path) where storage_path is not null;

-- ============================================
-- PRIVATE STORAGE BUCKET
-- 25 MiB object limit. Only application/octet-stream is allowed because
-- every stored object is ciphertext. NOT public.
-- ============================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vaultdrop-files',
  'vaultdrop-files',
  false,
  26214400,
  array['application/octet-stream']::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
