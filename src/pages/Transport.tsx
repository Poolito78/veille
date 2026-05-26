import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2, Check, X, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Bareme {
  id: string;
  poidsMin: number;
  poidsMax: number | null;
  prixHt: number;
  ordre: number;
}

function dbToBareme(r: Record<string, unknown>): Bareme {
  return {
    id: r.id as string,
    poidsMin: r.poids_min as number,
    poidsMax: r.poids_max != null ? (r.poids_max as number) : null,
    prixHt: r.prix_ht as number,
    ordre: r.ordre as number,
  };
}

type Tab = 'calcul' | 'baremes';

export default function Transport() {
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<Tab>('calcul');
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [loading, setLoading] = useState(true);

  // Calculateur
  const [poids, setPoids] = useState('');
  const [result, setResult] = useState<{ prix: number; tranche: Bareme } | null>(null);
  const [calcError, setCalcError] = useState('');

  // Édition inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editMin, setEditMin] = useState('');
  const [editMax, setEditMax] = useState('');
  const [editPrix, setEditPrix] = useState('');
  const [saving, setSaving] = useState(false);

  // Ajout
  const [addOpen, setAddOpen] = useState(false);
  const [newMin, setNewMin] = useState('');
  const [newMax, setNewMax] = useState('');
  const [newPrix, setNewPrix] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('transport_baremes')
      .select('*')
      .order('ordre');
    if (error) toast.error('Erreur chargement barèmes : ' + error.message);
    setBaremes((data ?? []).map(dbToBareme));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Calculateur ──────────────────────────────────────────────────────────
  const calculer = () => {
    setCalcError('');
    setResult(null);
    const p = parseFloat(poids.replace(',', '.'));
    if (isNaN(p) || p <= 0) {
      setCalcError('Saisissez un poids valide (ex : 12.5)');
      return;
    }
    const tranche = baremes.find(
      b => p > b.poidsMin && (b.poidsMax === null || p <= b.poidsMax),
    );
    if (!tranche) {
      setCalcError('Aucune tranche ne correspond à ce poids');
      return;
    }
    setResult({ prix: tranche.prixHt, tranche });
  };

  // ── Édition ──────────────────────────────────────────────────────────────
  const startEdit = (b: Bareme) => {
    setEditId(b.id);
    setEditMin(String(b.poidsMin));
    setEditMax(b.poidsMax !== null ? String(b.poidsMax) : '');
    setEditPrix(String(b.prixHt));
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    const { error } = await supabase
      .from('transport_baremes')
      .update({
        poids_min: parseFloat(editMin),
        poids_max: editMax === '' ? null : parseFloat(editMax),
        prix_ht: parseFloat(editPrix),
      })
      .eq('id', editId);
    setSaving(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    setEditId(null);
    await load();
    toast.success('Tranche mise à jour');
  };

  const deleteBareme = async (id: string) => {
    const { error } = await supabase.from('transport_baremes').delete().eq('id', id);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    await load();
    toast.success('Tranche supprimée');
  };

  // ── Ajout ────────────────────────────────────────────────────────────────
  const saveNew = async () => {
    setSaving(true);
    const ordre = baremes.length > 0 ? Math.max(...baremes.map(b => b.ordre)) + 1 : 1;
    const { error } = await supabase.from('transport_baremes').insert({
      poids_min: parseFloat(newMin),
      poids_max: newMax === '' ? null : parseFloat(newMax),
      prix_ht: parseFloat(newPrix),
      ordre,
    });
    setSaving(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    setAddOpen(false);
    setNewMin(''); setNewMax(''); setNewPrix('');
    await load();
    toast.success('Tranche ajoutée');
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transport</h1>
        <p className="text-sm text-muted-foreground">Calcul des frais de transport par poids</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 border-b">
        {(['calcul', 'baremes'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'calcul' ? 'Calculateur' : 'Barèmes'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ── Onglet Calculateur ── */}
          {tab === 'calcul' && (
            <div className="max-w-sm space-y-4">
              <div className="space-y-2">
                <Label htmlFor="poids">Poids (kg)</Label>
                <div className="flex gap-2">
                  <Input
                    id="poids"
                    type="text"
                    inputMode="decimal"
                    placeholder="ex : 12.5"
                    value={poids}
                    onChange={e => { setPoids(e.target.value); setResult(null); setCalcError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') calculer(); }}
                  />
                  <Button onClick={calculer}>Calculer</Button>
                </div>
              </div>

              {calcError && (
                <p className="text-sm text-destructive">{calcError}</p>
              )}

              {result && (
                <div className="rounded-lg border bg-card p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <Truck className="h-5 w-5 text-primary" />
                    <span className="text-2xl font-bold">
                      {result.prix.toFixed(2)} €
                      <span className="text-sm font-normal text-muted-foreground ml-1">HT</span>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tranche appliquée :{' '}
                    <span className="font-medium text-foreground">
                      {result.tranche.poidsMin} – {result.tranche.poidsMax !== null ? result.tranche.poidsMax : '∞'} kg
                    </span>
                  </p>
                </div>
              )}

              {baremes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aucun barème configuré.{isAdmin ? ' Allez dans l\'onglet Barèmes pour en ajouter.' : ''}
                </p>
              )}
            </div>
          )}

          {/* ── Onglet Barèmes ── */}
          {tab === 'baremes' && (
            <div className="space-y-4">
              {baremes.length === 0 && !addOpen ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Aucune tranche configurée.
                </p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Poids min (kg)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Poids max (kg)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Prix HT (€)</th>
                        {isAdmin && <th className="w-20 px-4 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {baremes.map(b => (
                        <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                          {editId === b.id ? (
                            <>
                              <td className="px-3 py-1.5">
                                <Input value={editMin} onChange={e => setEditMin(e.target.value)} className="h-8 w-24" />
                              </td>
                              <td className="px-3 py-1.5">
                                <Input value={editMax} onChange={e => setEditMax(e.target.value)} placeholder="∞" className="h-8 w-24" />
                              </td>
                              <td className="px-3 py-1.5">
                                <Input value={editPrix} onChange={e => setEditPrix(e.target.value)} className="h-8 w-24" />
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex gap-1 justify-end">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveEdit} disabled={saving}>
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditId(null)}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-2">{b.poidsMin}</td>
                              <td className="px-4 py-2">
                                {b.poidsMax !== null ? b.poidsMax : <span className="text-muted-foreground">∞</span>}
                              </td>
                              <td className="px-4 py-2 font-medium">{b.prixHt.toFixed(2)}</td>
                              {isAdmin && (
                                <td className="px-3 py-2">
                                  <div className="flex gap-1 justify-end">
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(b)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => deleteBareme(b.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}

                      {/* Ligne d'ajout */}
                      {isAdmin && addOpen && (
                        <tr className="bg-muted/20">
                          <td className="px-3 py-1.5">
                            <Input value={newMin} onChange={e => setNewMin(e.target.value)} placeholder="0" className="h-8 w-24" />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input value={newMax} onChange={e => setNewMax(e.target.value)} placeholder="∞" className="h-8 w-24" />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input value={newPrix} onChange={e => setNewPrix(e.target.value)} placeholder="0.00" className="h-8 w-24" />
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={saveNew}
                                disabled={saving || !newMin || !newPrix}
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAddOpen(false)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {isAdmin && !addOpen && (
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Ajouter une tranche
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
