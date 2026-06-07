import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { logVeilleHistorique } from './historique';

// ── Nom d'affichage créateur ───────────────────────────────────────────────
const LS_KEY = 'veille_creator_names';

export function getCreatorNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

export function setCreatorName(email: string, displayName: string) {
  const map = getCreatorNames();
  map[email] = displayName;
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

export function formatCreateur(emailOrName: string | undefined): string {
  if (!emailOrName) return '—';
  const map = getCreatorNames();
  return map[emailOrName] || emailOrName;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Concurrent {
  id: string;
  nom: string;
  siteWeb?: string;
  notes?: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConcurrentProduit {
  id: string;
  concurrentId: string;
  nom: string;
  reference?: string;
  categorie?: string;
  quantite?: number;        // prix par quantité (ex : 1, 25, 1000…)
  prixHT?: number;
  description?: string;
  clientId?: string;
  clientNom?: string;       // nom du client source
  informateur?: string;     // nom de la personne qui a renseigné le prix
  dateRenseignement?: string; // date de collecte du prix (YYYY-MM-DD)
  createdBy?: string;
  createdByEmail?: string;
  createdAt: string;
}

export interface ConcurrentNote {
  id: string;
  concurrentId: string;
  titre: string;
  contenu?: string;
  source?: string;
  dateNote: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt: string;
}

// ── DB mapping ─────────────────────────────────────────────────────────────

function dbToConcurrent(r: any): Concurrent {
  return {
    id: r.id,
    nom: r.nom,
    siteWeb: r.site_web || undefined,
    notes: r.notes || undefined,
    createdBy: r.created_by || undefined,
    createdByEmail: r.created_by_email || undefined,
    createdAt: r.created_at?.split('T')[0] || '',
    updatedAt: r.updated_at?.split('T')[0] || '',
  };
}

function concurrentToDb(c: Concurrent) {
  return {
    id: c.id,
    nom: c.nom,
    site_web: c.siteWeb || null,
    notes: c.notes || null,
    created_by: c.createdBy || null,
    created_by_email: c.createdByEmail || null,
  };
}

function dbToConcurrentProduit(r: any): ConcurrentProduit {
  return {
    id: r.id,
    concurrentId: r.concurrent_id,
    nom: r.nom,
    reference: r.reference || undefined,
    categorie: r.categorie || undefined,
    quantite: r.quantite != null ? Number(r.quantite) : undefined,
    prixHT: r.prix_ht != null ? Number(r.prix_ht) : undefined,
    description: r.description || undefined,
    clientId: r.client_id || undefined,
    clientNom: r.client_nom || undefined,
    informateur: r.informateur || undefined,
    dateRenseignement: r.date_renseignement || undefined,
    createdBy: r.created_by || undefined,
    createdByEmail: r.created_by_email || undefined,
    createdAt: r.created_at?.split('T')[0] || '',
  };
}

function concurrentProduitToDb(p: ConcurrentProduit) {
  return {
    id: p.id,
    concurrent_id: p.concurrentId,
    nom: p.nom,
    reference: p.reference || null,
    categorie: p.categorie || null,
    prix_ht: p.prixHT ?? null,
    description: p.description || null,
    client_id: p.clientId || null,
    created_by: p.createdBy || null,
    created_by_email: p.createdByEmail || null,
    // Colonnes ajoutées via migration — incluses conditionnellement pour éviter
    // l'erreur PostgREST si la migration n'a pas encore été appliquée
    ...(p.quantite !== undefined ? { quantite: p.quantite ?? null } : {}),
    ...(p.clientNom !== undefined ? { client_nom: p.clientNom || null } : {}),
    ...(p.informateur !== undefined ? { informateur: p.informateur || null } : {}),
    ...(p.dateRenseignement !== undefined ? { date_renseignement: p.dateRenseignement || null } : {}),
  };
}

function dbToConcurrentNote(r: any): ConcurrentNote {
  return {
    id: r.id,
    concurrentId: r.concurrent_id,
    titre: r.titre,
    contenu: r.contenu || undefined,
    source: r.source || undefined,
    dateNote: r.date_note || r.created_at?.split('T')[0] || '',
    createdBy: r.created_by || undefined,
    createdByEmail: r.created_by_email || undefined,
    createdAt: r.created_at?.split('T')[0] || '',
  };
}

function concurrentNoteToDb(n: ConcurrentNote) {
  return {
    id: n.id,
    concurrent_id: n.concurrentId,
    titre: n.titre,
    contenu: n.contenu || null,
    source: n.source || null,
    date_note: n.dateNote || null,
    created_by: n.createdBy || null,
    created_by_email: n.createdByEmail || null,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useConcurrents() {
  const [concurrents, setConcurrents] = useState<Concurrent[]>([]);
  const [produits, setProduits] = useState<ConcurrentProduit[]>([]);
  const [notes, setNotes] = useState<ConcurrentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<{ id: string; email: string } | null>(null);
  const concurrentsRef = useRef<Concurrent[]>([]);

  // Garder concurrentsRef à jour pour y accéder dans les callbacks
  useEffect(() => { concurrentsRef.current = concurrents; }, [concurrents]);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      sessionRef.current = { id: session.user.id, email: session.user.email || '' };

      const [concRes, prodRes, noteRes, rolesRes] = await Promise.all([
        supabase.from('concurrents').select('*').order('nom'),
        supabase.from('concurrent_produits').select('*').order('nom'),
        supabase.from('concurrent_notes').select('*').order('date_note', { ascending: false }),
        supabase.from('veille_roles').select('email, display_name'),
      ]);

      if (concRes.data) setConcurrents(concRes.data.map(dbToConcurrent));
      if (prodRes.data) setProduits(prodRes.data.map(dbToConcurrentProduit));
      if (noteRes.data) setNotes(noteRes.data.map(dbToConcurrentNote));

      // Pré-charger les noms d'affichage pour formatCreateur
      if (rolesRes.data) {
        const map = getCreatorNames();
        let changed = false;
        for (const row of rolesRes.data) {
          if (row.email && row.display_name && map[row.email] !== row.display_name) {
            map[row.email] = row.display_name;
            changed = true;
          }
        }
        if (changed) localStorage.setItem(LS_KEY, JSON.stringify(map));
      }

      setLoading(false);
    }
    load();
  }, []);

  // ── Concurrents CRUD ──

  const addConcurrent = useCallback(async (c: Omit<Concurrent, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByEmail'>) => {
    const session = sessionRef.current;
    if (!session) return null;
    const newC: Concurrent = {
      ...c,
      id: crypto.randomUUID(),
      createdBy: session.id,
      createdByEmail: session.email,
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    };
    const { error } = await supabase.from('concurrents').insert(concurrentToDb(newC) as any);
    if (!error) {
      setConcurrents(prev => [...prev, newC].sort((a, b) => a.nom.localeCompare(b.nom)));
      logVeilleHistorique({ entiteType: 'concurrent', entiteId: newC.id, entiteNumero: newC.nom, action: 'creation' });
    }
    return error ? null : newC;
  }, []);

  const updateConcurrent = useCallback(async (c: Concurrent) => {
    const updated = { ...c, updatedAt: new Date().toISOString().split('T')[0] };
    const { error } = await supabase.from('concurrents').update(concurrentToDb(updated) as any).eq('id', c.id);
    if (!error) {
      setConcurrents(prev => prev.map(x => x.id === c.id ? updated : x));
      logVeilleHistorique({ entiteType: 'concurrent', entiteId: c.id, entiteNumero: c.nom, action: 'modification' });
    }
    return error;
  }, []);

  const deleteConcurrent = useCallback(async (id: string) => {
    const nom = concurrentsRef.current.find(x => x.id === id)?.nom || id;
    const { error } = await supabase.from('concurrents').delete().eq('id', id);
    if (!error) {
      setConcurrents(prev => prev.filter(x => x.id !== id));
      setProduits(prev => prev.filter(x => x.concurrentId !== id));
      setNotes(prev => prev.filter(x => x.concurrentId !== id));
      logVeilleHistorique({ entiteType: 'concurrent', entiteId: id, entiteNumero: nom, action: 'suppression' });
    }
    return error;
  }, []);

  // ── Produits CRUD ──

  const addProduit = useCallback(async (p: Omit<ConcurrentProduit, 'id' | 'createdAt' | 'createdBy' | 'createdByEmail'>) => {
    const session = sessionRef.current;
    if (!session) return null;
    const newP: ConcurrentProduit = {
      ...p,
      id: crypto.randomUUID(),
      createdBy: session.id,
      createdByEmail: session.email,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const { error } = await supabase.from('concurrent_produits').insert(concurrentProduitToDb(newP) as any);
    if (!error) {
      setProduits(prev => [...prev, newP].sort((a, b) => a.nom.localeCompare(b.nom)));
      const concNom = concurrentsRef.current.find(c => c.id === newP.concurrentId)?.nom;
      logVeilleHistorique({
        entiteType: 'concurrent_produit', entiteId: newP.id, entiteNumero: newP.nom, action: 'creation',
        details: {
          ...(concNom ? { concurrent: concNom } : {}),
          ...(newP.prixHT != null ? { prixHT: `${newP.prixHT} €` } : {}),
          ...(newP.reference ? { reference: newP.reference } : {}),
          ...(newP.categorie ? { categorie: newP.categorie } : {}),
        },
      });
    }
    return error ? null : newP;
  }, []);

  const updateProduit = useCallback(async (p: ConcurrentProduit) => {
    const { error } = await supabase.from('concurrent_produits').update(concurrentProduitToDb(p) as any).eq('id', p.id);
    if (!error) {
      setProduits(prev => prev.map(x => x.id === p.id ? p : x));
      const concNom = concurrentsRef.current.find(c => c.id === p.concurrentId)?.nom;
      logVeilleHistorique({
        entiteType: 'concurrent_produit', entiteId: p.id, entiteNumero: p.nom, action: 'modification',
        details: {
          ...(concNom ? { concurrent: concNom } : {}),
          ...(p.prixHT != null ? { prixHT: `${p.prixHT} €` } : {}),
          ...(p.reference ? { reference: p.reference } : {}),
        },
      });
    }
    return error;
  }, []);

  const deleteProduit = useCallback(async (id: string) => {
    const prod = produits.find(x => x.id === id);
    const { error } = await supabase.from('concurrent_produits').delete().eq('id', id);
    if (!error) {
      setProduits(prev => prev.filter(x => x.id !== id));
      if (prod) {
        const concNom = concurrentsRef.current.find(c => c.id === prod.concurrentId)?.nom;
        logVeilleHistorique({
          entiteType: 'concurrent_produit', entiteId: id, entiteNumero: prod.nom, action: 'suppression',
          details: concNom ? { concurrent: concNom } : {},
        });
      }
    }
    return error;
  }, [produits]);

  // ── Notes CRUD ──

  const addNote = useCallback(async (n: Omit<ConcurrentNote, 'id' | 'createdAt' | 'createdBy' | 'createdByEmail'>) => {
    const session = sessionRef.current;
    if (!session) return null;
    const newN: ConcurrentNote = {
      ...n,
      id: crypto.randomUUID(),
      createdBy: session.id,
      createdByEmail: session.email,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const { error } = await supabase.from('concurrent_notes').insert(concurrentNoteToDb(newN) as any);
    if (!error) {
      setNotes(prev => [newN, ...prev]);
      const concNom = concurrentsRef.current.find(c => c.id === newN.concurrentId)?.nom;
      logVeilleHistorique({
        entiteType: 'concurrent_note', entiteId: newN.id, entiteNumero: newN.titre, action: 'creation',
        details: concNom ? { concurrent: concNom } : {},
      });
    }
    return error ? null : newN;
  }, []);

  const updateNote = useCallback(async (n: ConcurrentNote) => {
    const { error } = await supabase.from('concurrent_notes').update(concurrentNoteToDb(n) as any).eq('id', n.id);
    if (!error) {
      setNotes(prev => prev.map(x => x.id === n.id ? n : x));
      const concNom = concurrentsRef.current.find(c => c.id === n.concurrentId)?.nom;
      logVeilleHistorique({
        entiteType: 'concurrent_note', entiteId: n.id, entiteNumero: n.titre, action: 'modification',
        details: concNom ? { concurrent: concNom } : {},
      });
    }
    return error;
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    const note = notes.find(x => x.id === id);
    const { error } = await supabase.from('concurrent_notes').delete().eq('id', id);
    if (!error) {
      setNotes(prev => prev.filter(x => x.id !== id));
      if (note) {
        const concNom = concurrentsRef.current.find(c => c.id === note.concurrentId)?.nom;
        logVeilleHistorique({
          entiteType: 'concurrent_note', entiteId: id, entiteNumero: note.titre, action: 'suppression',
          details: concNom ? { concurrent: concNom } : {},
        });
      }
    }
    return error;
  }, [notes]);

  return {
    concurrents, produits, notes, loading,
    addConcurrent, updateConcurrent, deleteConcurrent,
    addProduit, updateProduit, deleteProduit,
    addNote, updateNote, deleteNote,
  };
}
