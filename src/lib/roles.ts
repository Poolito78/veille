import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export type Role = 'admin' | 'contributeur' | 'lecteur';

export interface VeilleUser {
  id: string;
  email: string;
  displayName?: string;
  veilleRole: Role | null;   // null = pas d'accès Veille
  crmAccess: boolean;
  invitedAt?: string;
}

// ── Hook: current user's role ──────────────────────────────────────────────

export function useRole() {
  const [role, setRole] = useState<Role | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      setUserId(session.user.id);

      const { data } = await supabase
        .from('veille_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle();

      setRole((data?.role as Role) || 'lecteur');
      setLoading(false);
    }
    load();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { load(); });
    return () => subscription.unsubscribe();
  }, []);

  return {
    role, userId, loading,
    isAdmin: role === 'admin',
    canEdit: role === 'admin' || role === 'contributeur',
  };
}

// ── Admin: list all users ──────────────────────────────────────────────────

export async function listVeilleUsers(): Promise<VeilleUser[]> {
  const { data, error } = await supabase
    .from('veille_roles')
    .select('user_id, role, display_name, email, crm_access, invited_at')
    .order('invited_at', { ascending: false });

  if (error || !data) return [];

  return data.map((r: any) => ({
    id: r.user_id,
    email: r.email || r.user_id,
    displayName: r.display_name || undefined,
    veilleRole: r.role as Role | null,
    crmAccess: r.crm_access ?? false,
    invitedAt: r.invited_at?.split('T')[0] || undefined,
  }));
}

export async function updateUserAccess(userId: string, veilleRole: Role | null, crmAccess: boolean) {
  return supabase
    .from('veille_roles')
    .update({ role: veilleRole || 'lecteur', crm_access: crmAccess })
    .eq('user_id', userId);
}

export async function removeUser(userId: string) {
  return supabase.from('veille_roles').delete().eq('user_id', userId);
}
