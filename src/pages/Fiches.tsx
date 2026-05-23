import { useState } from 'react';
import { Plus, Search, Globe, ChevronDown, ChevronUp, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useConcurrents } from '@/lib/concurrents';
import type { Concurrent } from '@/lib/concurrents';
import { useRole } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const emptyForm = { nom: '', siteWeb: '', notes: '' };

export default function Fiches() {
  const { concurrents, produits, notes, loading, addConcurrent, updateConcurrent, deleteConcurrent } = useConcurrents();
  const { canEdit } = useRole();

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Concurrent | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = concurrents.filter(c =>
    c.nom.toLowerCase().includes(search.toLowerCase()) ||
    (c.siteWeb || '').toLowerCase().includes(search.toLowerCase()),
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(c: Concurrent) {
    setEditing(c);
    setForm({ nom: c.nom, siteWeb: c.siteWeb || '', notes: c.notes || '' });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.nom.trim()) return;
    setSaving(true);
    if (editing) {
      await updateConcurrent({ ...editing, nom: form.nom.trim(), siteWeb: form.siteWeb || undefined, notes: form.notes || undefined });
    } else {
      await addConcurrent({ nom: form.nom.trim(), siteWeb: form.siteWeb || undefined, notes: form.notes || undefined });
    }
    setSaving(false);
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    await deleteConcurrent(id);
    setDeleteId(null);
    if (expanded === id) setExpanded(null);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Concurrents</h1>
          <p className="text-sm text-muted-foreground">{concurrents.length} fiche{concurrents.length > 1 ? 's' : ''}</p>
        </div>
        <div className="sm:ml-auto flex gap-2">
          {canEdit && (
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nouveau concurrent
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Aucun concurrent</p>
          {canEdit && <p className="text-sm mt-1">Cliquez sur « Nouveau concurrent » pour commencer.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const concProduits = produits.filter(p => p.concurrentId === c.id);
            const concNotes = notes.filter(n => n.concurrentId === c.id);
            const isOpen = expanded === c.id;

            return (
              <div key={c.id} className="border rounded-lg bg-card overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/40 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.nom}</p>
                    {c.siteWeb && (
                      <a
                        href={c.siteWeb.startsWith('http') ? c.siteWeb : `https://${c.siteWeb}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5 w-fit"
                      >
                        <Globe className="h-3 w-3" />
                        {c.siteWeb}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{concProduits.length} produit{concProduits.length > 1 ? 's' : ''}</Badge>
                    <Badge variant="outline">{concNotes.length} note{concNotes.length > 1 ? 's' : ''}</Badge>
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); openEdit(c); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); setDeleteId(c.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/30">
                    {c.notes && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes générales</p>
                        <p className="text-sm whitespace-pre-wrap">{c.notes}</p>
                      </div>
                    )}
                    {concProduits.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Produits ({concProduits.length})</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {concProduits.slice(0, 6).map(p => (
                            <div key={p.id} className="bg-background border rounded-md px-3 py-2 text-sm">
                              <p className="font-medium truncate">{p.nom}</p>
                              {p.prixHT != null && (
                                <p className="text-xs text-muted-foreground">{p.prixHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} HT</p>
                              )}
                            </div>
                          ))}
                          {concProduits.length > 6 && (
                            <p className="text-xs text-muted-foreground">+{concProduits.length - 6} autres</p>
                          )}
                        </div>
                      </div>
                    )}
                    {concNotes.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Dernières notes</p>
                        <div className="space-y-1.5">
                          {concNotes.slice(0, 3).map(n => (
                            <div key={n.id} className="bg-background border rounded-md px-3 py-2">
                              <p className="text-sm font-medium">{n.titre}</p>
                              {n.contenu && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.contenu}</p>}
                              <p className="text-xs text-muted-foreground mt-1">{n.dateNote}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!c.notes && concProduits.length === 0 && concNotes.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucune information renseignée.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier le concurrent' : 'Nouveau concurrent'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nom">Nom *</Label>
              <Input id="nom" value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} placeholder="Nom du concurrent" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site">Site web</Label>
              <Input id="site" value={form.siteWeb} onChange={e => setForm(f => ({ ...f, siteWeb: e.target.value }))} placeholder="https://example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes générales</Label>
              <Textarea id="notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Observations, positionnement…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.nom.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer ce concurrent ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Toutes les données associées (produits, notes) seront supprimées définitivement.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Annuler</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
