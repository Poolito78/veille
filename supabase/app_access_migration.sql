-- Migration: ajouter colonnes email + crm_access à veille_roles
-- + créer une vue unifiée pour l'admin
-- Appliquer dans Supabase > SQL Editor

-- 1. Enrichir la table veille_roles
alter table public.veille_roles
  add column if not exists email text,
  add column if not exists crm_access boolean default false;

-- 2. Policy : les admins peuvent tout voir (pas seulement leur propre ligne)
drop policy if exists "authenticated can read own role" on public.veille_roles;

create policy "read own role"
  on public.veille_roles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "admin reads all"
  on public.veille_roles for select
  to authenticated
  using (
    (select role from public.veille_roles where user_id = auth.uid()) = 'admin'
  );

create policy "admin writes all"
  on public.veille_roles for all
  to authenticated
  using (
    (select role from public.veille_roles where user_id = auth.uid()) = 'admin'
  );
