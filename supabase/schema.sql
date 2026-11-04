-- Run this once in Supabase > SQL Editor > New query > Run

create sequence if not exists client_seq start 1001;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('AX-' || to_char(now(), 'YY') || '-' || lpad(nextval('client_seq')::text, 5, '0')),
  full_name text not null,
  business_name text,
  email text not null,
  phone text not null,
  phone_digits text not null,
  address text not null,
  id_type text not null,
  id_number text not null,
  id_photo_path text,
  signature_data text not null,
  initials text not null,
  consents jsonb not null,
  agreement_version text not null,
  agreement_sha256 text not null,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  status text not null default 'active' check (status in ('active','issue','closed')),
  live_url text,
  github_user text,
  vercel_user text,
  supabase_project text,
  handover_date date,
  notes text not null default '',
  updated_at timestamptz,
  updated_by text
);
create index if not exists clients_phone_idx on clients (phone_digits);
create index if not exists clients_signed_idx on clients (signed_at desc);
create index if not exists clients_ip_idx on clients (ip, signed_at);

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  admin text,
  action text not null,
  client_code text,
  detail text
);
create index if not exists audit_at_idx on audit_log (action, at desc);

-- Lock everything: only our server (service role key) can read/write. No public access.
alter table clients enable row level security;
alter table admin_users enable row level security;
alter table audit_log enable row level security;

-- Private bucket for ID photos
insert into storage.buckets (id, name, public) values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;
