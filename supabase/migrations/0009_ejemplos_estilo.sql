-- Blake Reservas · migración 0009
-- Fotos de EJEMPLO con su estilo (cornrows / flat twist / barrel twist) que Blake etiqueta a mano. Se le enseñan a Claude (modelo
-- barato) junto a la foto de la clienta para que distinga bien los estilos. Solo añade. No son fotos de clientas: las manda Blake.
-- Los archivos van al bucket privado kira-fotos, carpeta ejemplos/.

create table public.style_examples (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity unique,        -- el número que Blake ve en /ejemplos (#3)
  created_at    timestamptz not null default now(),
  estilo        text not null check (estilo in ('cornrows', 'twist', 'barrel_twist')),
  storage_path  text not null unique,
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer not null check (size_bytes > 0),
  sha256        text not null unique,                              -- la misma foto no se guarda dos veces
  description   text check (description is null or length(description) <= 300)
);

alter table public.style_examples enable row level security;       -- sin políticas: solo el servidor (service_role) accede
create index style_examples_estilo_idx on public.style_examples (estilo, created_at desc);
