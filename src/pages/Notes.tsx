import { useState } from 'react';
import { Plus, Search, Pencil, Trash2, Loader2, Calendar, Link } from 'lucide-react';
import { useConcurrents } from '@/lib/concurrents';
import type { ConcurrentNote } from '@/lib/concurrents';
import { useRole } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function Notes() {
  const { concurrents, notes, loading, addNote, updateNote, deleteNote } = useConcurrents();
  const { canEdit } = useRole();

  const [search, setSearch] = useState('');
  const [filterConc, setFilterConc] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ConcurrentNote | null>(null);
  const [form, setForm] = useState({ concurrentId: '', titre: '', contenu: '', source: '', dateNote: new Date().toISOString().split('T')[0] });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = notes.filter(n => {
    const matchSearch = n.titre.toLowerCase().includes(search.toLowerCase()) ||
      (n.contenu || '').toLowerCase().includes(search.toLowerCase()) ||
      (n.source || '').toLowerCase().includes(search.toLowerCase());
    const matchConc = filterConc === 'all' || n.concurrentId === filterConc;
    return matchSearch && matchConc;
  });

  function openNew() {
    setEditingNote(null);
    setForm({ concurrentId: concurrents[0]?.id || '', titre: '', contenu: '', source: '', dateNote: new Date().toISOString().split('T')[0] });
    setDialogOpen(true);
  }

  function openEdit(n: ConcurrentNote) {
    setEditingNote(n);
    setForm({ concurrentId: n.concurrentId, titre: n.titre, contenu: n.contenu || '', source: n.source || '', dateNote: n.dateNote });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.titre.trim() || !form.concurrentId) return;
    setSaving(true);
    if (editingNote) {
      await updateNote({ ...editingNote, titre: form.titre.trim(), contenu: form.contenu || undefined, source: form.source || undefined, dateNote: form.dateNote, concurrentId: form.concurrentId });
    } else {
      await addNote({ concurrentId: form.concurrentId, titre: form.titre.trim(), contenu: form.contenu || undefined, source: form.source || undefined, dateNote: form.dateNote });
    }
    setSaving(false);
    setDialogOpen(false);
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
          <h1 className="text-2xl font-bold">Notes de veille</h1>
          <p className="text-sm text-muted-foreground">{notes.length} note{notes.length > 1 ? 's' : ''}</p>
        </div>
        {canEdit && (
          <div className="sm:ml-auto">
            <Button size="sm" onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nouvelle note
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

      {/* Notes grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Aucune note</p>
          {canEdit && <p className="text-sm mt-1">Créez une note pour consigner une observation.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(n => (
            <div key={n.id} className="border rounded-lg bg-card p-4 space-y-2 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-tight">{n.titre}</p>
                  <Badge variant="outline" className="mt-1 text-xs">{concName(n.concurrentId)}</Badge>
                </div>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(n)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {n.contenu && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 flex-1">{n.contenu}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {n.dateNote}
                </span>
                {n.source && (
                  <span className="flex items-center gap-1 truncate">
                    <Link className="h-3 w-3 shrink-0" />
                    <span className="truncate">{n.source}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingNote ? 'Modifier la note' : 'Nouvelle note'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Concurrent *</Label>
              <Select value={form.concurrentId} onValueChange={v => setForm(f => ({ ...f, concurrentId: v }))}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>{concurrents.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Titre *</Label>
                <Input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} placeholder="Ex: Nouvelle offre prix volume" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.dateNote} onChange={e => setForm(f => ({ ...f, dateNote: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="URL, nom du contact…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Contenu</Label>
              <Textarea value={form.contenu} onChange={e => setForm(f => ({ ...f, contenu: e.target.value }))} rows={5} placeholder="Détails, observations…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.titre.trim() || !form.concurrentId}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingNote ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Supprimer cette note ?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Cette action est irréversible.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Annuler</Button>
            <Button variant="destructive" onClick={async () => { if (deleteId) { await deleteNote(deleteId); setDeleteId(null); } }}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
