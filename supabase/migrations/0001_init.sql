-- Blake Reservas · migración 0001
-- Esquema base: conversaciones, reservas, temporizadores, registro de eventos y seguridad.
-- Principio: todo el acceso va por el servidor (service_role). Nada es accesible desde el navegador.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Impide modificar o borrar filas de tablas de auditoría (append-only).
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'La tabla % es solo de añadir (append-only)', tg_table_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversaciones y mensajes
-- ---------------------------------------------------------------------------
create table public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  channel                text not null default 'instagram' check (channel in ('instagram')),
  contact_ref            text not null,                -- id del suscriptor en ManyChat
  display_name           text,
  intent                 text not null default 'desconocido'
                           check (intent in ('cita_salon','formacion_online','infoproducto',
                                             'formacion_presencial','otro','desconocido')),
  status                 text not null default 'abierta'
                           check (status in ('abierta','esperando_aprobacion','esperando_cliente','cerrada')),
  last_client_message_at timestamptz,                  -- ventana de 24 h de Instagram
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (channel, contact_ref)
);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  body            text not null,
  flagged         boolean not null default false,      -- sospecha de manipulación del modelo
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Reservas (citas de salón)
-- Estados: propuesta -> aprobada -> pendiente_pago -> pagada | expirada | cancelada
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                          uuid primary key default gen_random_uuid(),
  conversation_id             uuid references public.conversations(id) on delete set null,
  client_name                 text not null,
  client_email                text,
  service_description         text not null,           -- p. ej. "7 Trenzas · Sin extensiones"
  price_cents                 integer check (price_cents >= 0),   -- sale de Legacy / de tu aprobación
  deposit_cents               integer check (deposit_cents >= 0), -- paga y señal que eliges tú
  duration_minutes            integer check (duration_minutes > 0),
  starts_at                   timestamptz,
  ends_at                     timestamptz,
  status                      text not null default 'propuesta'
                                check (status in ('propuesta','aprobada','pendiente_pago',
                                                  'pagada','expirada','cancelada')),
  payment_deadline            timestamptz,             -- ahora + 10 min al aprobar
  stripe_session_id           text unique,
  calendar_event_id           text unique,             -- SOLO se borran eventos que tengan este id
  approved_by_telegram_user   bigint,
  approved_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  -- Una reserva que bloquea hueco debe tener horario completo.
  check (status not in ('aprobada','pendiente_pago','pagada')
         or (starts_at is not null and ends_at is not null))
);
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create index bookings_status_idx on public.bookings (status, payment_deadline);

-- Defensa extra contra dobles reservas: dos reservas activas no pueden solaparse.
-- (El calendario de Google sigue siendo la fuente de verdad; esto es un segundo cerrojo.)
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
  where (status in ('aprobada','pendiente_pago','pagada'));

-- ---------------------------------------------------------------------------
-- Temporizadores (10 min de la señal, 10-15 min del Typeform, ...)
-- Una tarea que se ejecuta cada minuto reclama los vencidos con claim_due_jobs().
-- ---------------------------------------------------------------------------
create table public.scheduled_jobs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('expirar_reserva','seguimiento_typeform','recordatorio')),
  run_at     timestamptz not null,
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'pendiente'
               check (status in ('pendiente','en_curso','hecho','fallido','cancelado')),
  attempts   integer not null default 0,
  last_error text,
  locked_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger scheduled_jobs_updated_at before update on public.scheduled_jobs
  for each row execute function public.set_updated_at();
create index scheduled_jobs_due_idx on public.scheduled_jobs (run_at) where status = 'pendiente';

-- Reclama hasta p_limit tareas vencidas sin que dos ejecuciones pisen la misma.
-- También recupera tareas "en_curso" atascadas más de 5 minutos.
create or replace function public.claim_due_jobs(p_limit integer default 20)
returns setof public.scheduled_jobs
language plpgsql
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.scheduled_jobs
    where (status = 'pendiente' and run_at <= now())
       or (status = 'en_curso' and locked_at < now() - interval '5 minutes')
    order by run_at
    limit p_limit
    for update skip locked
  )
  update public.scheduled_jobs j
     set status = 'en_curso',
         locked_at = now(),
         attempts = j.attempts + 1
    from due
   where j.id = due.id
  returning j.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotencia de webhooks (Stripe y compañía reintentan: no procesar dos veces)
-- ---------------------------------------------------------------------------
create table public.processed_webhooks (
  provider    text not null,
  external_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, external_id)
);

-- ---------------------------------------------------------------------------
-- Registro de eventos: alimenta la línea de tiempo y la vista de fallos del panel
-- ---------------------------------------------------------------------------
create table public.event_log (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  conversation_id uuid references public.conversations(id) on delete set null,
  booking_id      uuid references public.bookings(id) on delete set null,
  source          text not null
                    check (source in ('manychat','stripe','telegram','typeform','claude','calendar','legacy','system')),
  kind            text not null,                       -- p. ej. 'mensaje_recibido', 'propuesta_enviada', 'pago_confirmado'
  level           text not null default 'info' check (level in ('info','warn','error')),
  summary         text not null,
  detail          jsonb not null default '{}'::jsonb   -- nunca datos de tarjeta ni claves
);
create index event_log_at_idx on public.event_log (at desc);
create index event_log_conv_idx on public.event_log (conversation_id, at);
create index event_log_errors_idx on public.event_log (at desc) where level in ('warn','error');
create trigger event_log_no_update before update or delete on public.event_log
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Eventos de seguridad: lo que muestra la pestaña "Seguridad" del panel
-- ---------------------------------------------------------------------------
create table public.security_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  kind            text not null
                    check (kind in ('firma_invalida','telegram_no_autorizado','limite_de_peticiones',
                                    'posible_inyeccion','payload_inesperado','acceso_panel_denegado')),
  source          text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  detail          jsonb not null default '{}'::jsonb   -- sin datos personales innecesarios
);
create index security_events_at_idx on public.security_events (at desc);
create trigger security_events_no_update before update or delete on public.security_events
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Seguridad de acceso: RLS activada en todo y SIN políticas.
-- Con RLS sin políticas, anon y authenticated no pueden leer ni escribir nada.
-- Solo el servidor, con la clave service_role (que se salta la RLS), accede.
-- ---------------------------------------------------------------------------
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.bookings            enable row level security;
alter table public.scheduled_jobs      enable row level security;
alter table public.processed_webhooks  enable row level security;
alter table public.event_log           enable row level security;
alter table public.security_events     enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke execute on function public.claim_due_jobs(integer) from public;

-- Permisos explícitos para el servidor (no dependemos de los valores por defecto de la plataforma).
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.claim_due_jobs(integer) to service_role;

-- Tablas y funciones futuras: cerradas por defecto para anon y authenticated.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
