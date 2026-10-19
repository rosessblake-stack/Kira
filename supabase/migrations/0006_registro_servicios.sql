-- Blake Reservas · migración 0006
-- Registro de servicios: por cada cita aprobada se guarda lo que Kira sugería (horas, materiales, precio de Legacy),
-- lo que Blake dejó al aprobar y, cuando él lo anota después con /real, lo que de verdad se tardó y se gastó.
-- Con esos datos propios se calibrará cuántas horas y cuánto material lleva cada peinado.
-- Solo añade; no toca datos existentes. Solo campos cerrados (nada de texto libre del cliente).

create table public.service_records (
  id                     uuid primary key default gen_random_uuid(),
  seq                    bigint generated always as identity unique,   -- el número que Blake ve en /real (#12)
  booking_id             uuid unique references public.bookings(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  is_test                boolean not null default false,               -- salió de un /simular: no cuenta para calibrar
  ubicacion              text not null default 'espana' check (ubicacion in ('espana', 'miami')),
  moneda                 text not null default 'EUR' check (moneda in ('EUR', 'USD')),
  client_name            text,                                         -- solo para reconocer la cita en /real
  starts_at              timestamptz,

  -- el servicio (valores de listas cerradas)
  tipo_trenzado          text,
  numero_trenzas         integer check (numero_trenzas is null or numero_trenzas between 1 and 200),
  tamano                 text,
  estilo                 text,
  extensiones            text,
  boho                   boolean,
  largo_cabello          text,
  largo_extensiones      text,

  -- lo que Kira sugería por defecto
  horas_sugeridas        numeric(5, 2) check (horas_sugeridas is null or horas_sugeridas >= 0),
  materiales_sugeridos   numeric(8, 2) check (materiales_sugeridos is null or materiales_sugeridos >= 0),
  precio_legacy_cents    integer check (precio_legacy_cents is null or precio_legacy_cents >= 0),

  -- lo que Blake dejó al aprobar
  horas_aprobadas        numeric(5, 2) check (horas_aprobadas is null or horas_aprobadas >= 0),
  materiales_aprobados   numeric(8, 2) check (materiales_aprobados is null or materiales_aprobados >= 0),
  precio_aprobado_cents  integer check (precio_aprobado_cents is null or precio_aprobado_cents >= 0),
  precio_origen          text check (precio_origen is null or precio_origen in ('legacy', 'manual')),

  -- lo real, anotado por Blake después del servicio
  horas_reales           numeric(5, 2) check (horas_reales is null or (horas_reales > 0 and horas_reales <= 24)),
  materiales_reales      numeric(8, 2) check (materiales_reales is null or materiales_reales >= 0),
  precio_real_cents      integer check (precio_real_cents is null or precio_real_cents >= 0),
  nota_real              text check (nota_real is null or char_length(nota_real) <= 500),
  real_at                timestamptz,

  perfil                 jsonb not null default '{}'::jsonb            -- perfil de Legacy con el que se calculó
);

create trigger service_records_updated_at before update on public.service_records
  for each row execute function public.set_updated_at();
create index service_records_created_idx on public.service_records (created_at desc);
create index service_records_real_idx on public.service_records (tipo_trenzado, tamano, extensiones)
  where horas_reales is not null and not is_test;

-- Mismo criterio que el resto: RLS activada y sin políticas; solo el servidor (service_role) accede.
alter table public.service_records enable row level security;
revoke all on public.service_records from anon, authenticated;
grant all on public.service_records to service_role;
