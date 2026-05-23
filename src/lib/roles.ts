import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export type Role = 'admin' | 'contributeur' | 'lecteur';

export interface VeilleUser {
  id: string;
  email: string;
  role: Role;
  displayName?: string;
  invitedAt?: string;
  lastSignIn?: string;
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      load();
    });
    return () => subscription.unsubscribe();
  }, []);

  return { role, userId, loading, isAdmin: role === 'admin', canEdit: role === 'admin' || role === 'contributeur' };
}

// ── Admin: list all users with roles ──────────────────────────────────────

export async function listVeilleUsers(): Promise<VeilleUser[]> {
  const { data, error } = await supabase
    .from('veille_roles')
    .select('user_id, role, display_name, invited_at')
    .order('invited_at', { ascending: false });

  if (error || !data) return [];

  return data.map(r => ({
    id: r.user_id,
    email: r.display_name || r.user_id,
    role: r.role as Role,
    displayName: r.display_name || undefined,
    invitedAt: r.invited_at?.split('T')[0] || undefined,
  }));
}

export async function setUserRole(userId: string, role: Role) {
  return supabase
    .from('veille_roles')
    .update({ role })
    .eq('user_id', userId);
}

export async function removeUser(userId: string) {
  return supabase
    .from('veille_roles')
    .delete()
    .eq('user_id', userId);
}
