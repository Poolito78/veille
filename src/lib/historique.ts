import { supabase } from './supabase';

/** Fire-and-forget — partagé avec la table historique du CRM (même projet Supabase) */
export function logVeilleHistorique(entry: {
  entiteType: 'concurrent' | 'concurrent_produit' | 'concurrent_note';
  entiteId: string;
  entiteNumero: string;
  action: 'creation' | 'modification' | 'suppression';
  details?: Record<string, unknown>;
}): void {
  supabase.auth.getUser().then(({ data }) => {
    const userId = data?.user?.id;
    if (!userId) return;
    supabase.from('historique').insert({
      user_id: userId,
      entite_type: entry.entiteType,
      entite_id: entry.entiteId,
      entite_numero: entry.entiteNumero,
      action: entry.action,
      details: entry.details ?? null,
    }).then(({ error }) => {
      if (error) console.warn('[historique veille]', error.message);
    });
  });
}
