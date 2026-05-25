import { useState, useRef, useCallback, useMemo } from 'react';
import { Plus, Search, Upload, Loader2, Check, X, Pencil, Trash2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { useConcurrents } from '@/lib/concurrents';
import type { ConcurrentProduit } from '@/lib/concurrents';
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

const PROMPT = `Extrais toutes les lignes produit/article/prestation de ce document avec leur prix.
Retourne un JSON array (uniquement, sans markdown) : [{"nom":"...","reference":"...","categorie":"...","prixHT":"...","description":"..."}]
Si un champ est absent, utilise une chaîne vide. prixHT doit être un nombre décimal (ex: "12.50").`;

async function callAI(texte: string): Promise<ExtractedProduit[]> {
  const body = { model: '', messages: [{ role: 'user', content: `${PROMPT}\n\n${texte.slice(0, 12000)}` }], max_tokens: 2000, temperature: 0.1 };

  // Groq
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ ...body, model: 'llama-3.1-70b-versatile' }),
      });
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content || '';
      return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
    } catch { /* fallthrough */ }
  }

  // Gemini
  const gemKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (gemKey) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gemKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${PROMPT}\n\n${texte.slice(0, 12000)}` }] }] }),
      });
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
    } catch { /* fallthrough */ }
  }

  // OpenRouter
  const orKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (orKey) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orKey}` },
      body: JSON.stringify({ ...body, model: 'mistralai/mistral-7b-instruct' }),
    });
    const d = await r.json();
    const text = d.choices?.[0]?.message?.content || '';
    return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
  }

  throw new Error('Aucune clé API configurée (VITE_GROQ_API_KEY, VITE_GEMINI_API_KEY ou VITE_OPENROUTER_API_KEY)');
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
  const { concurrents, produits, loading, addProduit, updateProduit, deleteProduit } = useConcurrents();
  const { canEdit } = useRole();

  const [search, setSearch] = useState('');
  const [filterConc, setFilterConc] = useState('all');

  // Manual dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ConcurrentProduit | null>(null);
  const [form, setForm] = useState({ concurrentId: '', nom: '', reference: '', categorie: '', prixHT: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importConcId, setImportConcId] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedProduit[]>([]);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setForm({ concurrentId: concurrents[0]?.id || '', nom: '', reference: '', categorie: '', prixHT: '', description: '' });
    setManualOpen(true);
  }

  function openEdit(p: ConcurrentProduit) {
    setEditingProd(p);
    setForm({ concurrentId: p.concurrentId, nom: p.nom, reference: p.reference || '', categorie: p.categorie || '', prixHT: p.prixHT != null ? String(p.prixHT) : '', description: p.description || '' });
    setManualOpen(true);
  }

  async function handleSave() {
    if (!form.nom.trim() || !form.concurrentId) return;
    setSaving(true);
    const prixHT = form.prixHT ? parseFloat(form.prixHT.replace(',', '.')) : undefined;
    if (editingProd) {
      await updateProduit({ ...editingProd, nom: form.nom.trim(), reference: form.reference || undefined, categorie: form.categorie || undefined, prixHT, description: form.description || undefined });
    } else {
      await addProduit({ concurrentId: form.concurrentId, nom: form.nom.trim(), reference: form.reference || undefined, categorie: form.categorie || undefined, prixHT, description: form.description || undefined });
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
      const results = await callAI(text);
      setExtracted(results.map((r, i) => ({ ...r, _id: String(i), selected: true })));
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
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterConc} onValueChange={setFilterConc}>
          <SelectTrigger className="w-48">
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
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Catégorie</th>
                <th className="text-right px-4 py-2.5 font-medium">Prix HT</th>
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
                    {p.reference && <p className="text-xs text-muted-foreground">{p.reference}</p>}
                    <p className="text-xs text-muted-foreground sm:hidden">{concName(p.concurrentId)}</p>
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">{concName(p.concurrentId)}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {p.categorie ? <Badge variant="outline">{p.categorie}</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    {p.prixHT != null ? p.prixHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
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
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
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

            {/* Drop zone */}
            {extracted.length === 0 && !analysing && (
              <div
                className={cn('border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer', dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}
                onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragOver(true); }}
                onDragOver={e => e.preventDefault()}
                onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
                onDrop={e => { e.preventDefault(); dragCounter.current = 0; setDragOver(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">Glissez votre tarif ici</p>
                <p className="text-sm text-muted-foreground mt-1">PDF, Excel (.xlsx, .xls), CSV — analyse IA automatique</p>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.ods" onChange={e => handleFiles(e.target.files)} />
              </div>
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
