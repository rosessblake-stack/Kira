-- Blake Reservas · migración 0011
-- Ficha de cada clienta (petición de Blake, 21-oct): para reconocer a quien vuelve y no pedirle otra vez nombre, email ni la foto
-- del pelo. Se identifica por su usuario de Instagram (el que da Meta). Solo datos básicos; se rellena al aprobar una cita y al
-- confirmarse. Se puede ver y borrar desde Telegram (/ficha, /borrarficha). Solo añade; RLS sin políticas (solo el servidor).

create table public.clients (
  id                   uuid primary key default gen_random_uuid(),
  instagram            text not null unique check (instagram = lower(instagram) and instagram ~ '^[a-z0-9._]{1,30}$'),
  nombre               text check (nombre is null or length(nombre) <= 60),
  email                text check (email is null or length(email) <= 120),
  ubicacion            text not null default 'espana' check (ubicacion in ('espana', 'miami')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  ultima_solicitud_at  timestamptz,
  ultima_cita_at       timestamptz,
  citas_confirmadas    integer not null default 0 check (citas_confirmadas >= 0),
  ultimo_servicio      text check (ultimo_servicio is null or length(ultimo_servicio) <= 120)
);
alter table public.clients enable row level security;
