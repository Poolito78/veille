import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from './supabase';

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
    client_nom: p.clientNom || null,
    informateur: p.informateur || null,
    date_renseignement: p.dateRenseignement || null,
    created_by: p.createdBy || null,
    created_by_email: p.createdByEmail || null,
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

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      sessionRef.current = { id: session.user.id, email: session.user.email || '' };

      const [concRes, prodRes, noteRes] = await Promise.all([
        supabase.from('concurrents').select('*').order('nom'),
        supabase.from('concurrent_produits').select('*').order('nom'),
        supabase.from('concurrent_notes').select('*').order('date_note', { ascending: false }),
      ]);

      if (concRes.data) setConcurrents(concRes.data.map(dbToConcurrent));
      if (prodRes.data) setProduits(prodRes.data.map(dbToConcurrentProduit));
      if (noteRes.data) setNotes(noteRes.data.map(dbToConcurrentNote));
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
    if (!error) setConcurrents(prev => [...prev, newC].sort((a, b) => a.nom.localeCompare(b.nom)));
    return error ? null : newC;
  }, []);

  const updateConcurrent = useCallback(async (c: Concurrent) => {
    const updated = { ...c, updatedAt: new Date().toISOString().split('T')[0] };
    const { error } = await supabase.from('concurrents').update(concurrentToDb(updated) as any).eq('id', c.id);
    if (!error) setConcurrents(prev => prev.map(x => x.id === c.id ? updated : x));
    return error;
  }, []);

  const deleteConcurrent = useCallback(async (id: string) => {
    const { error } = await supabase.from('concurrents').delete().eq('id', id);
    if (!error) {
      setConcurrents(prev => prev.filter(x => x.id !== id));
      setProduits(prev => prev.filter(x => x.concurrentId !== id));
      setNotes(prev => prev.filter(x => x.concurrentId !== id));
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
    if (!error) setProduits(prev => [...prev, newP].sort((a, b) => a.nom.localeCompare(b.nom)));
    return error ? null : newP;
  }, []);

  const updateProduit = useCallback(async (p: ConcurrentProduit) => {
    const { error } = await supabase.from('concurrent_produits').update(concurrentProduitToDb(p) as any).eq('id', p.id);
    if (!error) setProduits(prev => prev.map(x => x.id === p.id ? p : x));
    return error;
  }, []);

  const deleteProduit = useCallback(async (id: string) => {
    const { error } = await supabase.from('concurrent_produits').delete().eq('id', id);
    if (!error) setProduits(prev => prev.filter(x => x.id !== id));
    return error;
  }, []);

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
    if (!error) setNotes(prev => [newN, ...prev]);
    return error ? null : newN;
  }, []);

  const updateNote = useCallback(async (n: ConcurrentNote) => {
    const { error } = await supabase.from('concurrent_notes').update(concurrentNoteToDb(n) as any).eq('id', n.id);
    if (!error) setNotes(prev => prev.map(x => x.id === n.id ? n : x));
    return error;
  }, []);

  const deleteNote = useCallback(async (id: string) => {
    const { error } = await supabase.from('concurrent_notes').delete().eq('id', id);
    if (!error) setNotes(prev => prev.filter(x => x.id !== id));
    return error;
  }, []);

  return {
    concurrents, produits, notes, loading,
    addConcurrent, updateConcurrent, deleteConcurrent,
    addProduit, updateProduit, deleteProduit,
    addNote, updateNote, deleteNote,
  };
}
