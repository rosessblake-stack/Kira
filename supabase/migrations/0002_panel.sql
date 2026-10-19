-- Blake Reservas · migración 0002
-- Panel de administración: enlaces de acceso de un solo uso, sesiones y ajustes (Pausar Kira).
-- Mismo principio que 0001: RLS activada y SIN políticas; solo el servidor (service_role) accede.
-- Los tokens nunca se guardan en claro: solo su hash SHA-256.

-- ---------------------------------------------------------------------------
-- Enlaces de acceso: los emite el bot de Telegram al administrador (/panel).
-- Caducan a los 5 minutos y se pueden usar una sola vez.
-- ---------------------------------------------------------------------------
create table public.panel_login_tokens (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  check (expires_at > created_at)
);
create index panel_login_tokens_open_idx on public.panel_login_tokens (expires_at) where used_at is null;

-- ---------------------------------------------------------------------------
-- Sesiones del panel (la cookie del navegador lleva el token; aquí solo su hash).
-- ---------------------------------------------------------------------------
create table public.panel_sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

-- ---------------------------------------------------------------------------
-- Ajustes del sistema. De momento: kira_paused (interruptor "Pausar Kira").
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key check (key ~ '^[a-z_]+$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value) values ('kira_paused', 'false'::jsonb);

-- ---------------------------------------------------------------------------
-- Seguridad de acceso (igual que 0001)
-- ---------------------------------------------------------------------------
alter table public.panel_login_tokens enable row level security;
alter table public.panel_sessions     enable row level security;
alter table public.app_settings       enable row level security;

revoke all on public.panel_login_tokens, public.panel_sessions, public.app_settings from anon, authenticated;
grant all on public.panel_login_tokens, public.panel_sessions, public.app_settings to service_role;
