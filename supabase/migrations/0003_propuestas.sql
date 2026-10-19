-- Blake Reservas · migración 0003
-- Propuestas de cita: lo que Kira entiende de un mensaje, el precio que da Legacy, los avisos para Blake
-- y el estado de los botones de Telegram. Añade además el canal de PRUEBA (mensajes simulados por Blake).
-- Solo añade; no toca datos existentes.

-- ---------------------------------------------------------------------------
-- Canal de prueba: conversaciones simuladas con /simular, claramente separadas de las reales.
-- ---------------------------------------------------------------------------
alter table public.conversations drop constraint conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check check (channel in ('instagram', 'prueba'));

-- ---------------------------------------------------------------------------
-- Propuestas = reservas en estado 'propuesta'. Campos nuevos:
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column is_test             boolean     not null default false,        -- reserva de una conversación simulada
  add column spec                jsonb       not null default '{}'::jsonb,  -- lo que Kira entendió (campos ya validados)
  add column pricing             jsonb       not null default '{}'::jsonb,  -- perfil usado y respuesta de Legacy (auditable)
  add column warnings            jsonb       not null default '[]'::jsonb,  -- avisos para Blake (faltan datos, sin comprobar agenda...)
  add column reply_draft         text,                                      -- borrador para el cliente: nunca sale sin Aprobar
  add column proposal_nonce      text unique,                               -- identificador de un solo uso de los botones vigentes
  add column telegram_message_id bigint,                                    -- mensaje de Telegram que lleva esos botones
  add column edit_requested_at   timestamptz;                               -- Blake pulsó Editar y se espera su cambio

-- Las reservas de prueba nunca bloquean un hueco real: se rehace el cerrojo anti-solape sin ellas.
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
  where (status in ('aprobada', 'pendiente_pago', 'pagada') and not is_test);

create index bookings_awaiting_edit_idx on public.bookings (edit_requested_at)
  where status = 'propuesta' and edit_requested_at is not null;
