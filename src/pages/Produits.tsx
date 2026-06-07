import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Plus, Search, Upload, Loader2, Check, X, Pencil, Trash2, SlidersHorizontal, Columns2, RotateCcw, Filter, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { formatCreateur } from '@/lib/concurrents';
import type { ConcurrentProduit } from '@/lib/concurrents';
import { useConcurrentsCtx } from '@/lib/ConcurrentsContext';
import { useRole } from '@/lib/roles';
import { parseExcel } from '@/lib/parseExcel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTableColumns } from '@/hooks/useTableColumns';
import ColResizeHandle from '@/components/ColResizeHandle';
import RowActionsMenu from '@/components/RowActionsMenu';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

// ── Colonnes ────────────────────────────────────────────────────────────────
const ALL_COL_KEYS = ['nom', 'concurrent', 'reference', 'categorie', 'prixHT', 'description', 'clientNom', 'informateur', 'date'] as const;
type ColKey = typeof ALL_COL_KEYS[number];

const COL_DEFS: { key: ColKey; label: string; defaultVisible: boolean }[] = [
  { key: 'nom',        label: 'Produit',       defaultVisible: true },
  { key: 'concurrent', label: 'Concurrent',    defaultVisible: true },
  { key: 'reference',  label: 'Référence',     defaultVisible: true },
  { key: 'categorie',  label: 'Catégorie',     defaultVisible: true },
  { key: 'prixHT',     label: 'Prix HT',       defaultVisible: true },
  { key: 'description',label: 'Description',   defaultVisible: true },
  { key: 'clientNom',  label: 'Client source', defaultVisible: true },
  { key: 'informateur',label: 'Saisi par',     defaultVisible: true },
  { key: 'date',       label: 'Date',          defaultVisible: true },
];

const VIS_KEY = 'veille_prod_visible_cols';

function loadVisibleCols(): Set<ColKey> {
  try {
    const s = localStorage.getItem(VIS_KEY);
    if (s) {
      const arr = JSON.parse(s) as ColKey[];
      if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set(COL_DEFS.filter(c => c.defaultVisible).map(c => c.key));
}

// ── AI helpers (inchangés) ─────────────────────────────────────────────────

interface ExtractedProduit {
  _id: string;
  nom: string;
  reference: string;
  categorie: string;
  prixHT: string;
  description: string;
  selected: boolean;
}

const PROMPT = `Extrais toutes les lignes produit/article/prestation de ce document avec leur prix.
Retourne un JSON array (uniquement, sans markdown) : [{"nom":"...","reference":"...","categorie":"...","prixHT":"...","description":"..."}]
Si un champ est absent, utilise une chaîne vide. prixHT doit être un nombre décimal (ex: "12.50").`;

function parseJsonArray(text: string): ExtractedProduit[] {
  const match = text.match(/\[[\s\S]*\]/)?.[0];
  if (!match) return [];
  try { return JSON.parse(match); } catch { return []; }
}

async function callAI(texte: string): Promise<ExtractedProduit[]> {
  const content = `${PROMPT}\n\n${texte.slice(0, 12000)}`;
  const providerErrors: string[] = [];

  const groqKey = __GROQ_KEY__;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content }], max_tokens: 2000, temperature: 0.1 }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error?.message || `Groq HTTP ${r.status}`);
      const text = d.choices?.[0]?.message?.content || '';
      const results = parseJsonArray(text);
      if (results.length > 0) return results;
    } catch (e: any) {
      providerErrors.push(`Groq: ${e.message}`);
      console.warn('[Groq]', e.message);
    }
  }

  const gemKey = __GEMINI_KEY__;
  if (gemKey) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${gemKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: content }] }] }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error?.message || `Gemini HTTP ${r.status}`);
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const results = parseJsonArray(text);
      if (results.length > 0) return results;
    } catch (e: any) {
      providerErrors.push(`Gemini: ${e.message}`);
      console.warn('[Gemini]', e.message);
    }
  }

  const orKey = __OPENROUTER_KEY__;
  if (orKey) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orKey}` },
        body: JSON.stringify({ model: 'mistralai/mistral-7b-instruct:free', messages: [{ role: 'user', content }], max_tokens: 2000, temperature: 0.1 }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error?.message || `OpenRouter HTTP ${r.status}`);
      const text = d.choices?.[0]?.message?.content || '';
      return parseJsonArray(text);
    } catch (e: any) {
      providerErrors.push(`OpenRouter: ${e.message}`);
    }
  }

  if (!groqKey && !gemKey && !orKey) {
    throw new Error('Aucune clé IA configurée. Ajoutez VITE_GROQ_API_KEY, VITE_GEMINI_API_KEY ou VITE_OPENROUTER_API_KEY dans les variables d\'environnement Vercel. Pour un fichier CSV/Excel, l\'import sans IA est possible — renommez les colonnes : nom, reference, categorie, prixHT.');
  }
  if (providerErrors.length > 0) {
    throw new Error(`Erreur API IA — ${providerErrors.join(' | ')}`);
  }
  return [];
}

function tryDirectParse(texte: string): ExtractedProduit[] {
  const lines = texte.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = (names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));
  const iNom = idx(['nom', 'designation', 'libelle', 'produit', 'article', 'name']);
  const iRef = idx(['ref', 'reference', 'code']);
  const iCat = idx(['cat', 'famille', 'type', 'family']);
  const iPrix = idx(['prix', 'price', 'tarif', 'ht', 'montant']);
  const iDesc = idx(['desc', 'details', 'comment']);
  if (iNom < 0) return [];
  return lines.slice(1).map((line, i) => {
    const cols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    return {
      _id: String(i),
      nom: cols[iNom] || '',
      reference: iRef >= 0 ? cols[iRef] || '' : '',
      categorie: iCat >= 0 ? cols[iCat] || '' : '',
      prixHT: iPrix >= 0 ? cols[iPrix]?.replace(',', '.') || '' : '',
      description: iDesc >= 0 ? cols[iDesc] || '' : '',
      selected: true,
    };
  }).filter(p => p.nom);
}

async function extractText(file: File): Promise<string> {
  if (file.name.match(/\.(xlsx?|csv|ods)$/i)) {
    const { texte } = await parseExcel(file);
    return texte;
  }
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str).join(' '));
  }
  return pages.join('\n\n');
}

// ── Composant principal ────────────────────────────────────────────────────

export default function Produits() {
  const { concurrents, produits, loading, addProduit, updateProduit, deleteProduit } = useConcurrentsCtx();
  const { canEdit, displayName } = useRole();

  // ── Colonnes ──
  const cols = useTableColumns<ColKey>('veille_prod_table', ALL_COL_KEYS);
  const [visibleCols, setVisibleColsState] = useState<Set<ColKey>>(loadVisibleCols);
  const [colVizOpen, setColVizOpen] = useState(false);
  const colVizRef = useRef<HTMLDivElement>(null);

  function toggleCol(k: ColKey) {
    setVisibleColsState(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      try { localStorage.setItem(VIS_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  }

  // Fermer le panel colonnes au clic extérieur
  useEffect(() => {
    if (!colVizOpen) return;
    const handler = (e: MouseEvent) => {
      if (!colVizRef.current?.contains(e.target as Node)) setColVizOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colVizOpen]);

  // ── Filtres inline ──
  const [filters, setFilters] = useState<Partial<Record<ColKey, string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<ColKey | null>(null);

  function setFilter(k: ColKey, v: string) {
    setFilters(prev => v ? { ...prev, [k]: v } : (({ [k]: _, ...rest }) => rest)(prev as Record<ColKey, string>));
  }

  const activeFilters = Object.entries(filters) as [ColKey, string][];

  // ── Tri ──
  const [sort, setSort] = useState<{ col: ColKey; dir: 'asc' | 'desc' } | null>(null);
  // Clic : asc → desc → aucun
  function toggleSort(k: ColKey) {
    setSort(s => s?.col === k ? (s.dir === 'asc' ? { col: k, dir: 'desc' } : null) : { col: k, dir: 'asc' });
  }

  // Valeur d'une cellule (réutilisée pour filtre + tri).
  const cellValue = useCallback((p: ConcurrentProduit, key: ColKey): string | number => {
    switch (key) {
      case 'nom': return p.nom;
      case 'concurrent': return concurrents.find(c => c.id === p.concurrentId)?.nom || '';
      case 'reference': return p.reference || '';
      case 'categorie': return p.categorie || '';
      case 'prixHT': return p.prixHT != null ? p.prixHT : -Infinity;
      case 'description': return p.description || '';
      case 'clientNom': return p.clientNom || '';
      case 'informateur': return p.informateur || formatCreateur(p.createdByEmail);
      case 'date': return p.dateRenseignement || p.createdAt || '';
    }
  }, [concurrents]);

  // ── Recherche globale ──
  const [search, setSearch] = useState('');
  const [filterConc, setFilterConc] = useState('all');

  // ── Dialog manuel ──
  const [manualOpen, setManualOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ConcurrentProduit | null>(null);
  const [form, setForm] = useState({ concurrentId: '', nom: '', reference: '', categorie: '', prixHT: '', description: '', clientNom: '', informateur: '', dateRenseignement: '' });
  const [saving, setSaving] = useState(false);
  const [showNomSuggestions, setShowNomSuggestions] = useState(false);

  const nomSuggestions = useMemo(() => {
    const q = form.nom.trim().toLowerCase();
    if (!q) return [];
    const unique = Array.from(new Set(produits.map(p => p.nom)));
    return unique.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [form.nom, produits]);

  function selectNomSuggestion(nom: string) {
    const match = produits.find(p => p.nom === nom);
    setForm(f => ({ ...f, nom, reference: f.reference || match?.reference || '', categorie: f.categorie || match?.categorie || '' }));
    setShowNomSuggestions(false);
  }

  // ── Import tarif ──
  const [importOpen, setImportOpen] = useState(false);
  const [importConcId, setImportConcId] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedProduit[]>([]);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Filtrage + tri ──
  const filtered = useMemo(() => {
    const result = produits.filter(p => {
      // Recherche globale
      if (search) {
        const q = search.toLowerCase();
        const ok = p.nom.toLowerCase().includes(q) ||
          (p.reference || '').toLowerCase().includes(q) ||
          (p.categorie || '').toLowerCase().includes(q);
        if (!ok) return false;
      }
      // Filtre concurrent dropdown
      if (filterConc !== 'all' && p.concurrentId !== filterConc) return false;
      // Filtres colonnes inline
      for (const [key, val] of activeFilters) {
        if (!val) continue;
        const cell = String(cellValue(p, key));
        if (!cell.toLowerCase().includes(val.toLowerCase())) return false;
      }
      return true;
    });

    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        const va = cellValue(a, sort.col);
        const vb = cellValue(b, sort.col);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' }) * dir;
      });
    }
    return result;
  }, [produits, search, filterConc, activeFilters, sort, cellValue]);

  const concName = (id: string) => concurrents.find(c => c.id === id)?.nom || '—';

  // ── CRUD ──
  function openNew() {
    setEditingProd(null);
    setForm({ concurrentId: concurrents[0]?.id || '', nom: '', reference: '', categorie: '', prixHT: '', description: '', clientNom: '', informateur: displayName || '', dateRenseignement: new Date().toISOString().split('T')[0] });
    setManualOpen(true);
  }

  function openEdit(p: ConcurrentProduit) {
    setEditingProd(p);
    setForm({ concurrentId: p.concurrentId, nom: p.nom, reference: p.reference || '', categorie: p.categorie || '', prixHT: p.prixHT != null ? String(p.prixHT) : '', description: p.description || '', clientNom: p.clientNom || '', informateur: p.informateur || '', dateRenseignement: p.dateRenseignement || '' });
    setManualOpen(true);
  }

  async function handleSave() {
    if (!form.nom.trim() || !form.concurrentId) return;
    setSaving(true);
    const prixHT = form.prixHT ? parseFloat(form.prixHT.replace(',', '.')) : undefined;
    const extra = {
      reference: form.reference || undefined,
      categorie: form.categorie || undefined,
      prixHT,
      description: form.description || undefined,
      clientNom: form.clientNom || undefined,
      informateur: form.informateur || undefined,
      dateRenseignement: form.dateRenseignement || undefined,
    };
    if (editingProd) {
      await updateProduit({ ...editingProd, nom: form.nom.trim(), ...extra });
    } else {
      await addProduit({ concurrentId: form.concurrentId, nom: form.nom.trim(), ...extra });
    }
    setSaving(false);
    setManualOpen(false);
  }

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.match(/\.(pdf|xlsx?|csv|ods)$/i)) { setImportError('Format non supporté. Utilisez PDF, Excel ou CSV.'); return; }
    setAnalysing(true);
    setImportError('');
    setExtracted([]);
    try {
      const text = await extractText(file);
      const hasKey = !!(__GROQ_KEY__ || __GEMINI_KEY__ || __OPENROUTER_KEY__);
      let results: ExtractedProduit[] = [];
      if (hasKey) results = await callAI(text);
      if (results.length === 0 && file.name.match(/\.(xlsx?|csv|ods)$/i)) results = tryDirectParse(text);
      if (results.length === 0) {
        setImportError(!hasKey
          ? 'Aucune clé IA configurée. Pour un PDF, ajoutez VITE_GROQ_API_KEY dans Vercel. Pour un CSV/Excel, renommez les colonnes : nom, reference, categorie, prixHT.'
          : 'Aucun produit trouvé dans ce document. Vérifiez le format du fichier.');
      } else {
        setExtracted(results.map((r, i) => ({ ...r, _id: String(i), selected: true })));
      }
    } catch (e: any) {
      setImportError(e.message || 'Erreur lors de l\'analyse.');
    }
    setAnalysing(false);
  }, []);

  async function importerProduits() {
    const toImport = extracted.filter(p => p.selected);
    if (!importConcId || toImport.length === 0) return;
    setSaving(true);
    for (const p of toImport) {
      await addProduit({ concurrentId: importConcId, nom: p.nom, reference: p.reference || undefined, categorie: p.categorie || undefined, prixHT: p.prixHT ? parseFloat(p.prixHT.replace(',', '.')) : undefined, description: p.description || undefined });
    }
    setSaving(false);
    setImportOpen(false);
    setExtracted([]);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Colonnes visibles ordonnées (sans la col actions qui est toujours en dernier)
  const orderedCols = cols.ordered(COL_DEFS, k => visibleCols.has(k));

  return (
    <div className="space-y-4">
      {/* ── En-tête ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Produits concurrents</h1>
          <p className="text-sm text-muted-foreground">{produits.length} produit{produits.length > 1 ? 's' : ''} référencé{produits.length > 1 ? 's' : ''}</p>
        </div>
        {canEdit && (
          <div className="sm:ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setImportConcId(concurrents[0]?.id || ''); setExtracted([]); setImportError(''); setImportOpen(true); }} className="gap-1.5">
              <Upload className="h-4 w-4" /> Importer tarif
            </Button>
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>
        )}
      </div>

      {/* ── Barre filtres ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterConc} onValueChange={setFilterConc}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Tous les concurrents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les concurrents</SelectItem>
            {concurrents.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Filtres actifs ────────────────────────────────────────────────── */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {activeFilters.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
              {COL_DEFS.find(c => c.key === k)?.label} : {v}
              <button onClick={() => setFilter(k, '')} className="hover:text-primary/70">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button onClick={() => setFilters({})} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">
            Effacer tout
          </button>
        </div>
      )}

      {/* ── Tableau ───────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Aucun produit</p>
          {canEdit && <p className="text-sm mt-1">Ajoutez manuellement ou importez un tarif.</p>}
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                {orderedCols.map(col => (
                  <th
                    key={col.key}
                    className={cn(
                      'relative text-left px-3 py-0 font-medium select-none',
                      cols.dragKey === col.key && 'opacity-50',
                      cols.dragOverKey === col.key && 'bg-primary/10',
                    )}
                    style={cols.widthStyle(col.key)}
                    {...cols.thProps(col.key)}
                  >
                    <div className="flex items-center gap-1 py-2.5 pr-3">
                      {/* Libellé cliquable = tri */}
                      <button
                        onClick={e => { e.stopPropagation(); toggleSort(col.key); }}
                        className="flex items-center gap-1 min-w-0 hover:text-foreground"
                        title="Trier"
                      >
                        <span className="truncate">{col.label}</span>
                        {(() => {
                          const SortIcon = sort?.col === col.key ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
                          return <SortIcon className={cn('h-3 w-3 shrink-0', sort?.col === col.key ? 'text-primary' : 'opacity-40')} />;
                        })()}
                      </button>
                      {/* Icône filtre */}
                      <button
                        onClick={e => { e.stopPropagation(); setOpenFilterCol(prev => prev === col.key ? null : col.key); }}
                        className={cn(
                          'p-0.5 rounded shrink-0 transition-colors ml-auto',
                          (filters[col.key] || openFilterCol === col.key)
                            ? 'text-primary'
                            : 'text-muted-foreground/50 hover:text-muted-foreground',
                        )}
                        title="Filtrer"
                      >
                        <Filter className="h-3 w-3" />
                      </button>
                    </div>
                    {/* Input filtre inline */}
                    {openFilterCol === col.key && (
                      <div className="pb-1.5 px-0.5" onClick={e => e.stopPropagation()}>
                        <Input
                          autoFocus
                          className="h-6 text-xs"
                          placeholder={`Filtrer ${col.label}…`}
                          value={filters[col.key] || ''}
                          onChange={e => setFilter(col.key, e.target.value)}
                          onKeyDown={e => e.key === 'Escape' && setOpenFilterCol(null)}
                        />
                      </div>
                    )}
                    <ColResizeHandle {...cols.resizeHandleProps(col.key)} />
                  </th>
                ))}
                {/* Dernière colonne : actions + sélecteur de colonnes */}
                <th className="relative px-2 py-2.5 w-16">
                  <div ref={colVizRef} className="relative flex justify-end">
                    <button
                      onClick={() => setColVizOpen(o => !o)}
                      title="Colonnes visibles"
                      className={cn('p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors', colVizOpen && 'bg-muted text-foreground')}
                    >
                      <Columns2 className="h-4 w-4" />
                    </button>
                    {colVizOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-52 space-y-1">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colonnes</span>
                          <button
                            onClick={() => { cols.reset(); setVisibleColsState(new Set(COL_DEFS.map(c => c.key))); try { localStorage.removeItem(VIS_KEY); } catch { /* ignore */ } }}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <RotateCcw className="h-3 w-3" /> Réinitialiser
                          </button>
                        </div>
                        {COL_DEFS.map(col => (
                          <label key={col.key} className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={visibleCols.has(col.key)}
                              onChange={() => toggleCol(col.key)}
                              className="rounded accent-primary"
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className={cn('transition-colors hover:bg-muted/30', canEdit && 'cursor-pointer')}
                  onClick={canEdit ? () => openEdit(p) : undefined}
                >
                  {orderedCols.map(col => {
                    if (col.key === 'nom') return (
                      <td key="nom" className="px-3 py-2.5" style={cols.widthStyle('nom')}>
                        <p className="font-medium">{p.nom}</p>
                      </td>
                    );
                    if (col.key === 'concurrent') return (
                      <td key="concurrent" className="px-3 py-2.5 text-muted-foreground" style={cols.widthStyle('concurrent')}>{concName(p.concurrentId)}</td>
                    );
                    if (col.key === 'reference') return (
                      <td key="reference" className="px-3 py-2.5 text-xs text-muted-foreground font-mono" style={cols.widthStyle('reference')}>{p.reference || '—'}</td>
                    );
                    if (col.key === 'categorie') return (
                      <td key="categorie" className="px-3 py-2.5" style={cols.widthStyle('categorie')}>
                        {p.categorie ? <Badge variant="outline">{p.categorie}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                    if (col.key === 'prixHT') return (
                      <td key="prixHT" className="px-3 py-2.5 text-right font-medium" style={cols.widthStyle('prixHT')}>
                        {p.prixHT != null ? p.prixHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
                      </td>
                    );
                    if (col.key === 'description') return (
                      <td key="description" className="px-3 py-2.5 text-muted-foreground max-w-40 truncate" style={cols.widthStyle('description')}>{p.description || '—'}</td>
                    );
                    if (col.key === 'clientNom') return (
                      <td key="clientNom" className="px-3 py-2.5 text-xs text-muted-foreground" style={cols.widthStyle('clientNom')}>{p.clientNom || '—'}</td>
                    );
                    if (col.key === 'informateur') return (
                      <td key="informateur" className="px-3 py-2.5 text-xs text-muted-foreground" style={cols.widthStyle('informateur')}>{p.informateur || formatCreateur(p.createdByEmail)}</td>
                    );
                    if (col.key === 'date') return (
                      <td key="date" className="px-3 py-2.5 text-xs text-muted-foreground" style={cols.widthStyle('date')}>
                        {new Date((p.dateRenseignement || p.createdAt) + 'T00:00:00').toLocaleDateString('fr-FR')}
                      </td>
                    );
                    return null;
                  })}
                  <td className="px-2 py-2.5 w-16" onClick={e => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex justify-end">
                        <RowActionsMenu actions={[
                          { icon: <Pencil className="w-3.5 h-3.5" />, label: 'Modifier', onClick: () => openEdit(p) },
                          { icon: <Trash2 className="w-3.5 h-3.5" />, label: 'Supprimer', danger: true, onClick: () => setDeleteId(p.id) },
                        ]} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Dialog manuel ─────────────────────────────────────────────────── */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProd ? 'Modifier le produit' : 'Ajouter un produit'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Concurrent *</Label>
              <Select value={form.concurrentId} onValueChange={v => setForm(f => ({ ...f, concurrentId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{concurrents.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 relative">
              <Label>Nom *</Label>
              <Input
                value={form.nom}
                onChange={e => { setForm(f => ({ ...f, nom: e.target.value })); setShowNomSuggestions(true); }}
                onFocus={() => setShowNomSuggestions(true)}
                onBlur={() => setTimeout(() => setShowNomSuggestions(false), 150)}
                autoComplete="off"
                placeholder="Nom du produit…"
              />
              {showNomSuggestions && nomSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md overflow-hidden">
                  {nomSuggestions.map(nom => {
                    const match = produits.find(p => p.nom === nom);
                    return (
                      <button
                        key={nom}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2"
                        onMouseDown={() => selectNomSuggestion(nom)}
                      >
                        <span className="font-medium truncate">{nom}</span>
                        {match?.categorie && <span className="text-xs text-muted-foreground shrink-0">{match.categorie}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Référence</Label>
                <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Catégorie</Label>
                <Input value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Prix HT (€)</Label>
              <Input type="number" step="0.01" value={form.prixHT} onChange={e => setForm(f => ({ ...f, prixHT: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source du prix</p>
              <div className="space-y-1.5">
                <Label>Date de renseignement</Label>
                <Input type="date" value={form.dateRenseignement} onChange={e => setForm(f => ({ ...f, dateRenseignement: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Client source</Label>
                  <Input value={form.clientNom} onChange={e => setForm(f => ({ ...f, clientNom: e.target.value }))} placeholder="Nom du client" />
                </div>
                <div className="space-y-1.5">
                  <Label>Informateur</Label>
                  <Input value={form.informateur} onChange={e => setForm(f => ({ ...f, informateur: e.target.value }))} placeholder="Qui a renseigné ?" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.nom.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingProd ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog import tarif ───────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={v => { if (!analysing) setImportOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Importer un tarif concurrent</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="space-y-1.5">
              <Label>Concurrent *</Label>
              <Select value={importConcId} onValueChange={setImportConcId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>{concurrents.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {extracted.length === 0 && !analysing && (
              <label
                htmlFor="tarif-file-input"
                className={cn('block border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer', dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}
                onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragOver(true); }}
                onDragOver={e => e.preventDefault()}
                onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
                onDrop={e => { e.preventDefault(); dragCounter.current = 0; setDragOver(false); handleFiles(e.dataTransfer.files); }}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">Glissez votre tarif ici</p>
                <p className="text-sm text-muted-foreground mt-1">PDF, Excel (.xlsx, .xls), CSV — analyse IA automatique</p>
                <input id="tarif-file-input" type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.ods" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
              </label>
            )}
            {analysing && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analyse du document en cours…</p>
              </div>
            )}
            {importError && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-md px-4 py-3 text-sm text-destructive">
                {importError}
                <button className="ml-2 underline" onClick={() => setImportError('')}>Réessayer</button>
              </div>
            )}
            {extracted.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{extracted.filter(p => p.selected).length} / {extracted.length} produits sélectionnés</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setExtracted(e => e.map(p => ({ ...p, selected: true })))}>Tout</Button>
                    <Button variant="ghost" size="sm" onClick={() => setExtracted(e => e.map(p => ({ ...p, selected: false })))}>Aucun</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setExtracted([]); setImportError(''); }}>
                      <X className="h-4 w-4 mr-1" />Recommencer
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b sticky top-0">
                      <tr>
                        <th className="w-10 px-3 py-2" />
                        <th className="text-left px-3 py-2 font-medium">Nom</th>
                        <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Référence</th>
                        <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Catégorie</th>
                        <th className="text-right px-3 py-2 font-medium">Prix HT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {extracted.map(p => (
                        <tr key={p._id} className={cn('transition-colors', p.selected ? '' : 'opacity-40')}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={p.selected} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, selected: e.target.checked } : x))} className="rounded" />
                          </td>
                          <td className="px-3 py-2"><Input value={p.nom} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, nom: e.target.value } : x))} className="h-7 text-xs" /></td>
                          <td className="px-3 py-2 hidden sm:table-cell"><Input value={p.reference} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, reference: e.target.value } : x))} className="h-7 text-xs" /></td>
                          <td className="px-3 py-2 hidden md:table-cell"><Input value={p.categorie} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, categorie: e.target.value } : x))} className="h-7 text-xs" /></td>
                          <td className="px-3 py-2"><Input value={p.prixHT} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, prixHT: e.target.value } : x))} className="h-7 text-xs text-right w-24 ml-auto" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={saving}>Annuler</Button>
            {extracted.length > 0 && (
              <Button onClick={importerProduits} disabled={saving || !importConcId || extracted.filter(p => p.selected).length === 0}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <Check className="h-4 w-4" />
                Importer {extracted.filter(p => p.selected).length} produit{extracted.filter(p => p.selected).length > 1 ? 's' : ''}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmation suppression ──────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Supprimer ce produit ?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Cette action est irréversible.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Annuler</Button>
            <Button variant="destructive" onClick={async () => { if (deleteId) { await deleteProduit(deleteId); setDeleteId(null); } }}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
