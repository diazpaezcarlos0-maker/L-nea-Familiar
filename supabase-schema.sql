-- Ejecuta esto en Supabase: tu proyecto → SQL Editor → New query → pega y Run

create table if not exists families (
  code text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

-- Row Level Security: lo activamos pero dejamos que cualquiera con la
-- anon key pueda leer/escribir. Esto es igual de "seguro" que el código de
-- acceso del prototipo: quien conoce el código puede entrar y editar.
-- Es suficiente para uso familiar informal, pero no es autenticación real.
-- Cuando quieras subir el nivel de seguridad, el siguiente paso es usar
-- Supabase Auth (email o magic link) y políticas por usuario.

alter table families enable row level security;

create policy "cualquiera puede leer familias"
  on families for select
  using (true);

create policy "cualquiera puede crear una familia"
  on families for insert
  with check (true);

create policy "cualquiera puede actualizar una familia"
  on families for update
  using (true);
