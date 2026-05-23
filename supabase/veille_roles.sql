-- Migration: créer la table veille_roles
-- À appliquer dans le dashboard Supabase > SQL Editor
-- Projet: qkjxcfosutclnahvxflf

create table if not exists public.veille_roles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  role      text not null default 'lecteur' check (role in ('admin', 'contributeur', 'lecteur')),
  display_name text,
  invited_at timestamptz default now()
);

-- RLS: seuls les admins peuvent lire/modifier
alter table public.veille_roles enable row level security;

-- Tout utilisateur authentifié peut lire son propre rôle
create policy "user reads own role"
  on public.veille_roles for select
  using (auth.uid() = user_id);

-- Les admins peuvent tout lire
create policy "admin reads all roles"
  on public.veille_roles for select
  using (
    exists (
      select 1 from public.veille_roles r
      where r.user_id = auth.uid() and r.role = 'admin'
    )
  );

-- Les admins peuvent modifier
create policy "admin manages roles"
  on public.veille_roles for all
  using (
    exists (
      select 1 from public.veille_roles r
      where r.user_id = auth.uid() and r.role = 'admin'
    )
  );

-- Insérer le premier admin (remplacer par votre user_id Supabase)
-- insert into public.veille_roles (user_id, role, display_name)
-- values ('<votre-user-id>', 'admin', 'FM');
