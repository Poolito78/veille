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
  label: string;
  isSupplement: boolean;
  ordre: number;
}

function dbToBareme(r: Record<string, unknown>): Bareme {
  return {
    id: r.id as string,
    poidsMin: r.poids_min as number,
    poidsMax: r.poids_max != null ? (r.poids_max as number) : null,
    prixHt: r.prix_ht as number,
    label: (r.label as string) || '',
    isSupplement: (r.is_supplement as boolean) || false,
    ordre: r.ordre as number,
  };
}

type Tab = 'calcul' | 'baremes';

interface RowEdit {
  min: string;
  max: string;
  prix: string;
  label: string;
}

const emptyEdit = (): RowEdit => ({ min: '', max: '', prix: '', label: '' });

function baremeToEdit(b: Bareme): RowEdit {
  return {
    min: String(b.poidsMin),
    max: b.poidsMax !== null ? String(b.poidsMax) : '',
    prix: String(b.prixHt),
    label: b.label,
  };
}

export default function Transport() {
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<Tab>('calcul');

  // Données
  const [tranches, setTranches] = useState<Bareme[]>([]);
  const [supplements, setSupplements] = useState<Bareme[]>([]);
  const [seuilFranco, setSeuilFranco] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Calculateur
  const [poids, setPoids] = useState('');
  const [montant, setMontant] = useState('');
  const [suppChecked, setSuppChecked] = useState<Record<string, boolean>>({});
  const [calcResult, setCalcResult] = useState<{
    tranche: Bareme;
    prixTransport: number;
    total: number;
    franco: boolean;
  } | null>(null);
  const [calcError, setCalcError] = useState('');

  // Édition
  const [editId, setEditId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<RowEdit>(emptyEdit());
  const [saving, setSaving] = useState(false);

  // Ajout
  const [addingType, setAddingType] = useState<'tranche' | 'supplement' | null>(null);
  const [newVals, setNewVals] = useState<RowEdit>(emptyEdit());

  // Franco
  const [editFranco, setEditFranco] = useState(false);
  const [francoInput, setFrancoInput] = useState('');

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: bData }, { data: cData }] = await Promise.all([
      supabase.from('transport_baremes').select('*').order('ordre'),
      supabase.from('transport_config').select('*').eq('key', 'seuil_franco').maybeSingle(),
    ]);
    const all = (bData ?? []).map(dbToBareme);
    setTranches(all.filter(b => !b.isSupplement));
    setSupplements(all.filter(b => b.isSupplement));
    setSeuilFranco((cData as Record<string, unknown> | null)?.value_num as number ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Calculateur ───────────────────────────────────────────────────────────
  // Les tranches sont ordonnées par poids_max croissant.
  // On prend la première dont poids_max >= poids (ou poids_max null = dernière tranche).
  const calculer = () => {
    setCalcError('');
    setCalcResult(null);
    const p = parseFloat(poids.replace(',', '.'));
    if (isNaN(p) || p <= 0) { setCalcError('Saisissez un poids valide (ex : 45)'); return; }

    const tranche = tranches.find(b => b.poidsMax === null || p <= b.poidsMax);
    if (!tranche) { setCalcError('Aucune tranche ne correspond à ce poids'); return; }

    const m = parseFloat(montant.replace(',', '.')) || 0;
    const franco = seuilFranco !== null && m >= seuilFranco;
    const prixTransport = franco ? 0 : tranche.prixHt;
    const suppTotal = supplements
      .filter(s => suppChecked[s.id])
      .reduce((acc, s) => acc + s.prixHt, 0);

    setCalcResult({ tranche, prixTransport, total: prixTransport + suppTotal, franco });
  };

  // ── Enregistrer édition ────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    const isSup = supplements.some(s => s.id === editId);
    const payload: Record<string, unknown> = {
      prix_ht: parseFloat(editVals.prix),
      label: editVals.label,
    };
    if (!isSup) {
      payload.poids_min = parseFloat(editVals.min);
      payload.poids_max = editVals.max === '' ? null : parseFloat(editVals.max);
    }
    const { error } = await supabase.from('transport_baremes').update(payload).eq('id', editId);
    setSaving(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    setEditId(null);
    await load();
    toast.success('Mise à jour effectuée');
  };

  const deleteBareme = async (id: string) => {
    const { error } = await supabase.from('transport_baremes').delete().eq('id', id);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    await load();
    toast.success('Supprimé');
  };

  // ── Enregistrer ajout ──────────────────────────────────────────────────────
  const saveNew = async () => {
    if (!addingType) return;
    setSaving(true);
    const isSup = addingType === 'supplement';
    const all = [...tranches, ...supplements];
    const ordre = all.length > 0 ? Math.max(...all.map(b => b.ordre)) + 1 : 1;
    const payload: Record<string, unknown> = {
      prix_ht: parseFloat(newVals.prix),
      label: newVals.label,
      is_supplement: isSup,
      ordre,
      poids_min: isSup ? 0 : parseFloat(newVals.min),
      poids_max: isSup || newVals.max === '' ? null : parseFloat(newVals.max),
    };
    const { error } = await supabase.from('transport_baremes').insert(payload);
    setSaving(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    setAddingType(null);
    setNewVals(emptyEdit());
    await load();
    toast.success('Ajouté');
  };

  // ── Seuil franco ───────────────────────────────────────────────────────────
  const saveFranco = async () => {
    const v = parseFloat(francoInput.replace(',', '.'));
    if (isNaN(v)) return;
    setSaving(true);
    const { error } = await supabase
      .from('transport_config')
      .upsert({ key: 'seuil_franco', value_num: v });
    setSaving(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    setSeuilFranco(v);
    setEditFranco(false);
    toast.success('Seuil franco mis à jour');
  };

  // ── Composants helpers ────────────────────────────────────────────────────
  const EditCell = ({ val, onChange, placeholder, wide }: {
    val: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean;
  }) => (
    <Input
      value={val}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn('h-8', wide ? 'w-36' : 'w-24')}
    />
  );

  const ActionBtns = ({ onSave, onCancel, disabled }: {
    onSave: () => void; onCancel: () => void; disabled?: boolean;
  }) => (
    <div className="flex gap-1 justify-end">
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onSave} disabled={saving || disabled}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCancel}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────
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
          {/* ══════════ ONGLET CALCULATEUR ══════════ */}
          {tab === 'calcul' && (
            <div className="max-w-sm space-y-5">
              {seuilFranco !== null && (
                <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
                  Transport offert dès{' '}
                  <span className="font-semibold">
                    {seuilFranco.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT
                  </span>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="montant">
                    Montant commande HT (€){' '}
                    <span className="text-muted-foreground font-normal text-xs">— optionnel, pour détecter le franco</span>
                  </Label>
                  <Input
                    id="montant"
                    type="text"
                    inputMode="decimal"
                    placeholder="ex : 3 200"
                    value={montant}
                    onChange={e => { setMontant(e.target.value); setCalcResult(null); }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="poids">Poids total (kg)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="poids"
                      type="text"
                      inputMode="decimal"
                      placeholder="ex : 45"
                      value={poids}
                      onChange={e => { setPoids(e.target.value); setCalcResult(null); setCalcError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') calculer(); }}
                    />
                    <Button onClick={calculer}>Calculer</Button>
                  </div>
                </div>

                {supplements.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Suppléments</Label>
                    <div className="space-y-1.5">
                      {supplements.map(s => (
                        <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!suppChecked[s.id]}
                            onChange={e => {
                              setSuppChecked(prev => ({ ...prev, [s.id]: e.target.checked }));
                              setCalcResult(null);
                            }}
                            className="rounded"
                          />
                          <span>{s.label || 'Supplément'}</span>
                          <span className="text-muted-foreground ml-auto font-medium">
                            +{s.prixHt.toFixed(2)} €
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {calcError && <p className="text-sm text-destructive">{calcError}</p>}

              {calcResult && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  {calcResult.franco ? (
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-green-600" />
                      <span className="text-xl font-bold text-green-600">Transport offert</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold">
                        {calcResult.prixTransport.toFixed(2)} €
                        <span className="text-sm font-normal text-muted-foreground ml-1">HT</span>
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Tranche :{' '}
                    <span className="font-medium text-foreground">
                      {calcResult.tranche.poidsMin} – {calcResult.tranche.poidsMax ?? '∞'} kg
                    </span>
                  </p>

                  {supplements.filter(s => suppChecked[s.id]).length > 0 && (
                    <div className="border-t pt-2 mt-1 space-y-1">
                      {supplements.filter(s => suppChecked[s.id]).map(s => (
                        <div key={s.id} className="flex justify-between text-sm text-muted-foreground">
                          <span>{s.label}</span>
                          <span>+{s.prixHt.toFixed(2)} €</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                        <span>Total transport</span>
                        <span>{calcResult.total.toFixed(2)} € HT</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══════════ ONGLET BARÈMES ══════════ */}
          {tab === 'baremes' && (
            <div className="space-y-6">

              {/* Seuil franco */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium">Seuil franco port :</span>
                {editFranco ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={francoInput}
                      onChange={e => setFrancoInput(e.target.value)}
                      className="h-8 w-32"
                      placeholder="2700"
                    />
                    <span className="text-sm text-muted-foreground">€ HT</span>
                    <ActionBtns
                      onSave={saveFranco}
                      onCancel={() => setEditFranco(false)}
                      disabled={!francoInput}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {seuilFranco !== null
                        ? `${seuilFranco.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT`
                        : 'Non configuré'}
                    </span>
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          setFrancoInput(seuilFranco !== null ? String(seuilFranco) : '');
                          setEditFranco(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Tranches de poids */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Tranches de poids
                </h2>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Min (kg)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Max (kg)</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Prix HT (€)</th>
                        {isAdmin && <th className="w-20 px-4 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {tranches.map(b => (
                        <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                          {editId === b.id ? (
                            <>
                              <td className="px-3 py-1.5">
                                <EditCell val={editVals.min} onChange={v => setEditVals(p => ({ ...p, min: v }))} />
                              </td>
                              <td className="px-3 py-1.5">
                                <EditCell val={editVals.max} onChange={v => setEditVals(p => ({ ...p, max: v }))} placeholder="∞" />
                              </td>
                              <td className="px-3 py-1.5">
                                <EditCell val={editVals.prix} onChange={v => setEditVals(p => ({ ...p, prix: v }))} />
                              </td>
                              <td className="px-3 py-1.5">
                                <ActionBtns onSave={saveEdit} onCancel={() => setEditId(null)} />
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
                                    <Button size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => { setEditId(b.id); setEditVals(baremeToEdit(b)); }}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="icon" variant="ghost"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => deleteBareme(b.id)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}

                      {isAdmin && addingType === 'tranche' && (
                        <tr className="bg-muted/20">
                          <td className="px-3 py-1.5">
                            <EditCell val={newVals.min} onChange={v => setNewVals(p => ({ ...p, min: v }))} placeholder="0" />
                          </td>
                          <td className="px-3 py-1.5">
                            <EditCell val={newVals.max} onChange={v => setNewVals(p => ({ ...p, max: v }))} placeholder="∞" />
                          </td>
                          <td className="px-3 py-1.5">
                            <EditCell val={newVals.prix} onChange={v => setNewVals(p => ({ ...p, prix: v }))} placeholder="0.00" />
                          </td>
                          <td className="px-3 py-1.5">
                            <ActionBtns
                              onSave={saveNew}
                              onCancel={() => { setAddingType(null); setNewVals(emptyEdit()); }}
                              disabled={!newVals.min || !newVals.prix}
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {isAdmin && addingType !== 'tranche' && (
                  <Button variant="outline" size="sm"
                    onClick={() => { setAddingType('tranche'); setNewVals(emptyEdit()); }}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter une tranche
                  </Button>
                )}
              </div>

              {/* Suppléments */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Suppléments
                </h2>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Libellé</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Prix HT (€)</th>
                        {isAdmin && <th className="w-20 px-4 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {supplements.length === 0 && addingType !== 'supplement' && (
                        <tr>
                          <td colSpan={isAdmin ? 3 : 2}
                            className="px-4 py-4 text-center text-muted-foreground text-xs">
                            Aucun supplément configuré
                          </td>
                        </tr>
                      )}
                      {supplements.map(s => (
                        <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                          {editId === s.id ? (
                            <>
                              <td className="px-3 py-1.5">
                                <EditCell val={editVals.label}
                                  onChange={v => setEditVals(p => ({ ...p, label: v }))}
                                  placeholder="ex : Hayon" wide />
                              </td>
                              <td className="px-3 py-1.5">
                                <EditCell val={editVals.prix}
                                  onChange={v => setEditVals(p => ({ ...p, prix: v }))} />
                              </td>
                              <td className="px-3 py-1.5">
                                <ActionBtns onSave={saveEdit} onCancel={() => setEditId(null)} />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-2">{s.label || '—'}</td>
                              <td className="px-4 py-2 font-medium">{s.prixHt.toFixed(2)}</td>
                              {isAdmin && (
                                <td className="px-3 py-2">
                                  <div className="flex gap-1 justify-end">
                                    <Button size="icon" variant="ghost" className="h-7 w-7"
                                      onClick={() => { setEditId(s.id); setEditVals(baremeToEdit(s)); }}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button size="icon" variant="ghost"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => deleteBareme(s.id)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}

                      {isAdmin && addingType === 'supplement' && (
                        <tr className="bg-muted/20">
                          <td className="px-3 py-1.5">
                            <EditCell val={newVals.label}
                              onChange={v => setNewVals(p => ({ ...p, label: v }))}
                              placeholder="ex : Hayon" wide />
                          </td>
                          <td className="px-3 py-1.5">
                            <EditCell val={newVals.prix}
                              onChange={v => setNewVals(p => ({ ...p, prix: v }))}
                              placeholder="0.00" />
                          </td>
                          <td className="px-3 py-1.5">
                            <ActionBtns
                              onSave={saveNew}
                              onCancel={() => { setAddingType(null); setNewVals(emptyEdit()); }}
                              disabled={!newVals.label || !newVals.prix}
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {isAdmin && addingType !== 'supplement' && (
                  <Button variant="outline" size="sm"
                    onClick={() => { setAddingType('supplement'); setNewVals(emptyEdit()); }}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter un supplément
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
