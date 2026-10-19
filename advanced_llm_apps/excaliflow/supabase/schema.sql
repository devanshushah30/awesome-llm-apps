-- Excaliflow Cloud — Supabase schema.
-- Run this once in your Supabase project: SQL Editor → paste → Run.

create table if not exists public.diagrams (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled diagram',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagrams_updated_at_idx
  on public.diagrams (updated_at desc);

-- Row Level Security is ON, with deliberately NO policies:
-- the table is only ever touched with the service_role key from the
-- server-side API (Vercel functions / dev-server). The browser never
-- gets a Supabase key, so nothing needs to be exposed via RLS.
alter table public.diagrams enable row level security;
