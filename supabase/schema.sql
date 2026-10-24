create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  estado text not null default 'nuevo' check (estado in ('nuevo', 'preparando', 'listo', 'entregado', 'cancelado')),
  tipo text not null default 'delivery' check (tipo in ('delivery', 'pickup')),
  cliente_nombre text not null,
  cliente_telefono text,
  cliente_direccion text,
  cliente_pago text,
  cliente_notas text,
  items jsonb not null default '[]'::jsonb,
  subtotal integer not null check (subtotal >= 0),
  envio integer not null default 0 check (envio >= 0),
  total integer not null check (total >= 0)
);

create index if not exists pedidos_creado_en_idx on public.pedidos (creado_en desc);
create index if not exists pedidos_estado_idx on public.pedidos (estado);

alter table public.pedidos add column if not exists cliente_telefono text;

alter table public.pedidos enable row level security;
