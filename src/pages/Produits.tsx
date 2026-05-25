import { useState, useRef, useCallback, useMemo } from 'react';
import { Plus, Search, Upload, Loader2, Check, X, Pencil, Trash2 } from 'lucide-react';
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

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

interface ExtractedProduit {
  _id: string;
  nom: string;
  reference: string;
  categorie: string;
  prixHT: string;
  description: string;
  selected: boolean;
}

// v2
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

  // Groq
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
      // Réponse valide mais vide → continuer vers le provider suivant
    } catch (e: any) {
      console.warn('[Groq]', e.message);
      // fallthrough vers Gemini
    }
  }

  // Gemini
  const gemKey = __GEMINI_KEY__;
  if (gemKey) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gemKey}`, {
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
      console.warn('[Gemini]', e.message);
      // fallthrough vers OpenRouter
    }
  }

  // OpenRouter
  const orKey = __OPENROUTER_KEY__;
  if (orKey) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orKey}` },
      body: JSON.stringify({ model: 'mistralai/mistral-7b-instruct:free', messages: [{ role: 'user', content }], max_tokens: 2000, temperature: 0.1 }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error?.message || `OpenRouter HTTP ${r.status}`);
    const text = d.choices?.[0]?.message?.content || '';
    return parseJsonArray(text);
  }

  throw new Error('Aucune clé IA configurée. Ajoutez VITE_GROQ_API_KEY, VITE_GEMINI_API_KEY ou VITE_OPENROUTER_API_KEY dans les variables d\'environnement Vercel. Pour un fichier CSV/Excel, l\'import sans IA est possible — renommez les colonnes : nom, reference, categorie, prixHT.');
}

/** Essai d'import direct CSV/Excel sans IA (colonnes nommées). */
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
  // PDF via pdfjs
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

export default function Produits() {
  const { concurrents, produits, loading, addProduit, updateProduit, deleteProduit } = useConcurrentsCtx();
  const { canEdit, displayName } = useRole();

  const [search, setSearch] = useState('');
  const [filterConc, setFilterConc] = useState('all');

  // Manual dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ConcurrentProduit | null>(null);
  const [form, setForm] = useState({ concurrentId: '', nom: '', reference: '', categorie: '', prixHT: '', description: '', clientNom: '', informateur: '', dateRenseignement: '' });
  const [saving, setSaving] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importConcId, setImportConcId] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedProduit[]>([]);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showNomSuggestions, setShowNomSuggestions] = useState(false);

  // Unique product names matching current input (for autocomplete)
  const nomSuggestions = useMemo(() => {
    const q = form.nom.trim().toLowerCase();
    if (!q) return [];
    const unique = Array.from(new Set(produits.map(p => p.nom)));
    return unique.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [form.nom, produits]);

  function selectNomSuggestion(nom: string) {
    const match = produits.find(p => p.nom === nom);
    setForm(f => ({
      ...f,
      nom,
      reference: f.reference || match?.reference || '',
      categorie: f.categorie || match?.categorie || '',
      // prixHT intentionally left as-is — user enters the new price
    }));
    setShowNomSuggestions(false);
  }

  const filtered = produits.filter(p => {
    const matchSearch = p.nom.toLowerCase().includes(search.toLowerCase()) ||
      (p.reference || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.categorie || '').toLowerCase().includes(search.toLowerCase());
    const matchConc = filterConc === 'all' || p.concurrentId === filterConc;
    return matchSearch && matchConc;
  });

  // ── Manual CRUD ──

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

  // ── Import tarif ──

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.match(/\.(pdf|xlsx?|csv|ods)$/i)) {
      setImportError('Format non supporté. Utilisez PDF, Excel ou CSV.');
      return;
    }
    setAnalysing(true);
    setImportError('');
    setExtracted([]);
    try {
      const text = await extractText(file);
      // Essai IA en premier
      const hasKey = !!(__GROQ_KEY__ || __GEMINI_KEY__ || __OPENROUTER_KEY__);
      let results: ExtractedProduit[] = [];
      if (hasKey) {
        results = await callAI(text);
      }
      // Fallback : parse direct pour CSV/Excel si pas d'IA ou résultat vide
      if (results.length === 0 && file.name.match(/\.(xlsx?|csv|ods)$/i)) {
        results = tryDirectParse(text);
      }
      if (results.length === 0) {
        if (!hasKey) {
          setImportError('Aucune clé IA configurée. Pour un PDF, ajoutez VITE_GROQ_API_KEY dans Vercel. Pour un CSV/Excel, renommez les colonnes : nom, reference, categorie, prixHT.');
        } else {
          setImportError('Aucun produit trouvé dans ce document. Vérifiez le format du fichier.');
        }
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
      await addProduit({
        concurrentId: importConcId,
        nom: p.nom,
        reference: p.reference || undefined,
        categorie: p.categorie || undefined,
        prixHT: p.prixHT ? parseFloat(p.prixHT.replace(',', '.')) : undefined,
        description: p.description || undefined,
      });
    }
    setSaving(false);
    setImportOpen(false);
    setExtracted([]);
  }

  const concName = (id: string) => concurrents.find(c => c.id === id)?.nom || '—';

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Produits concurrents</h1>
          <p className="text-sm text-muted-foreground">{produits.length} produit{produits.length > 1 ? 's' : ''} référencé{produits.length > 1 ? 's' : ''}</p>
        </div>
        {canEdit && (
          <div className="sm:ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setImportConcId(concurrents[0]?.id || ''); setExtracted([]); setImportError(''); setImportOpen(true); }} className="gap-1.5">
              <Upload className="h-4 w-4" />
              Importer tarif
            </Button>
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
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

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Aucun produit</p>
          {canEdit && <p className="text-sm mt-1">Ajoutez manuellement ou importez un tarif.</p>}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Produit</th>
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Concurrent</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Référence</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Catégorie</th>
                <th className="text-right px-4 py-2.5 font-medium">Prix HT</th>
                <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Description</th>
                <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Client source</th>
                <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Saisi par</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Date</th>
                {canEdit && <th className="w-20" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className={cn('transition-colors', canEdit ? 'hover:bg-muted/30 cursor-pointer' : 'hover:bg-muted/30')}
                  onClick={canEdit ? () => openEdit(p) : undefined}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{p.nom}</p>
                    {p.reference && <p className="md:hidden text-xs text-muted-foreground">{p.reference}</p>}
                    <p className="text-xs text-muted-foreground sm:hidden">{concName(p.concurrentId)}</p>
                    {p.categorie && <p className="md:hidden mt-0.5"><Badge variant="outline" className="text-[10px] py-0 h-4">{p.categorie}</Badge></p>}
                    {p.description && <p className="lg:hidden text-xs text-muted-foreground mt-0.5 truncate max-w-48">{p.description}</p>}
                    {(p.clientNom || p.informateur) && (
                      <p className="text-xs text-muted-foreground mt-0.5 lg:hidden">
                        {p.clientNom && <span>📍 {p.clientNom}</span>}
                        {p.clientNom && p.informateur && <span className="mx-1">·</span>}
                        {p.informateur && <span>👤 {p.informateur}</span>}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">{concName(p.concurrentId)}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-xs text-muted-foreground font-mono">{p.reference || '—'}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {p.categorie ? <Badge variant="outline">{p.categorie}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <p className="font-medium">{p.prixHT != null ? p.prixHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}</p>
                    <p className="md:hidden text-xs text-muted-foreground">
                      {new Date((p.dateRenseignement || p.createdAt) + 'T00:00:00').toLocaleDateString('fr-FR')}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell text-sm text-muted-foreground max-w-40 truncate">{p.description || '—'}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">{p.clientNom || '—'}</td>
                  <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">{p.informateur || formatCreateur(p.createdByEmail)}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-xs text-muted-foreground">
                    {new Date((p.dateRenseignement || p.createdAt) + 'T00:00:00').toLocaleDateString('fr-FR')}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-7 sm:w-7" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-7 sm:w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                          <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Dialog */}
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
                        {match?.categorie && (
                          <span className="text-xs text-muted-foreground shrink-0">{match.categorie}</span>
                        )}
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

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={v => { if (!analysing) setImportOpen(v); }}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col"
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Importer un tarif concurrent</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Concurrent selector */}
            <div className="space-y-1.5">
              <Label>Concurrent *</Label>
              <Select value={importConcId} onValueChange={setImportConcId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>{concurrents.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Drop zone — label htmlFor active le file input sans click() programmatique */}
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
                <input
                  id="tarif-file-input"
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv,.ods"
                  onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                />
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
                <button className="ml-2 underline" onClick={() => { setImportError(''); }}>Réessayer</button>
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
                          <td className="px-3 py-2">
                            <Input value={p.nom} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, nom: e.target.value } : x))} className="h-7 text-xs" />
                          </td>
                          <td className="px-3 py-2 hidden sm:table-cell">
                            <Input value={p.reference} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, reference: e.target.value } : x))} className="h-7 text-xs" />
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell">
                            <Input value={p.categorie} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, categorie: e.target.value } : x))} className="h-7 text-xs" />
                          </td>
                          <td className="px-3 py-2">
                            <Input value={p.prixHT} onChange={e => setExtracted(ex => ex.map(x => x._id === p._id ? { ...x, prixHT: e.target.value } : x))} className="h-7 text-xs text-right w-24 ml-auto" />
                          </td>
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

      {/* Delete confirm */}
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
