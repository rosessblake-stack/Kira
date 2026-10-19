-- Blake Reservas · migración 0004
-- Fotos de las clientas (pelo y trenzas de referencia). Las pide Blake por Instagram y no llegan en texto:
-- se guardan en un almacén PRIVADO y aquí solo queda su ficha. Blake escribe qué se ve en cada una
-- (esas descripciones son, más adelante, los ejemplos con los que se podrá enseñar a Claude).
-- Mismo principio que 0001: RLS activada y SIN políticas; solo el servidor (service_role) accede.
-- Solo añade; no toca datos existentes.

-- ---------------------------------------------------------------------------
-- Almacén privado (bucket). Sin URLs públicas: el panel sirve cada foto tras comprobar la sesión de Blake.
-- Supabase ya trae el esquema `storage`; la guarda permite probar esta migración en un Postgres suelto.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('kira-fotos', 'kira-fotos', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Ficha de cada foto
-- ---------------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind            text not null check (kind in ('pelo', 'referencia', 'otra')),
  source          text not null check (source in ('telegram', 'manychat')),
  storage_path    text unique,                       -- null cuando la foto ya se ha borrado por caducidad
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes      integer not null check (size_bytes > 0 and size_bytes <= 4194304),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  description     text check (description is null or char_length(description) <= 1000),  -- lo que Blake dice que se ve
  described_at    timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,              -- la foto se borra al llegar aquí; la descripción se conserva
  purged_at       timestamptz,
  check (expires_at > created_at),
  check ((storage_path is null) = (purged_at is not null))
);
create index attachments_conversation_idx on public.attachments (conversation_id, created_at);
create index attachments_expiry_idx on public.attachments (expires_at) where purged_at is null;

alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;
grant all on public.attachments to service_role;
