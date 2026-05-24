import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { UserPlus, Loader2, Trash2, Shield, Check, X } from 'lucide-react';
import { useRole, listVeilleUsers, updateUserAccess, removeUser } from '@/lib/roles';
import type { VeilleUser, Role } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';


export default function Admin() {
  const { isAdmin } = useRole();
  const [users, setUsers] = useState<VeilleUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invVeilleRole, setInvVeilleRole] = useState<Role | 'none'>('contributeur');
  const [invCrm, setInvCrm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invMsg, setInvMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<VeilleUser | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    listVeilleUsers().then(u => { setUsers(u); setLoading(false); });
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Shield className="h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">Accès réservé aux administrateurs</p>
      </div>
    );
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!invEmail.trim()) return;
    if (invVeilleRole === 'none' && !invCrm) {
      setInvMsg({ type: 'error', text: 'Sélectionnez au moins une application.' });
      return;
    }
    setInviting(true);
    setInvMsg(null);

    const resp = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: invEmail.trim(),
        veilleRole: invVeilleRole === 'none' ? null : invVeilleRole,
        crmAccess: invCrm,
        displayName: invName.trim() || undefined,
      }),
    });

    const result = await resp.json() as { success?: boolean; existing?: boolean; error?: string };

    if (!resp.ok || result.error) {
      setInvMsg({ type: 'error', text: result.error || 'Erreur lors de l\'invitation' });
    } else {
      setInvMsg({
        type: 'success',
        text: result.existing
          ? `Accès mis à jour pour ${invEmail}`
          : `Invitation envoyée à ${invEmail}`,
      });
      setInvEmail(''); setInvName('');
      const updated = await listVeilleUsers();
      setUsers(updated);
    }
    setInviting(false);
  }

  async function handleAccessChange(user: VeilleUser, field: 'veilleRole' | 'crmAccess', value: Role | boolean) {
    setSaving(true);
    const newVeilleRole = field === 'veilleRole' ? (value as Role) : (user.veilleRole || 'lecteur');
    const newCrmAccess = field === 'crmAccess' ? (value as boolean) : user.crmAccess;
    await updateUserAccess(user.id, newVeilleRole, newCrmAccess);
    setUsers(prev => prev.map(u => u.id === user.id
      ? { ...u, veilleRole: field === 'veilleRole' ? (value as Role) : u.veilleRole, crmAccess: field === 'crmAccess' ? (value as boolean) : u.crmAccess }
      : u,
    ));
    setSaving(false);
  }

  async function handleDelete(user: VeilleUser) {
    setSaving(true);
    await removeUser(user.id);
    setUsers(prev => prev.filter(u => u.id !== user.id));
    setDeleteTarget(null);
    setSaving(false);
  }

  const veilleCount = users.filter(u => u.veilleRole).length;
  const crmCount = users.filter(u => u.crmAccess).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-sm text-muted-foreground">
            {users.length} utilisateur{users.length > 1 ? 's' : ''} —
            <span className="text-primary"> {veilleCount} Veille</span> ·
            <span className="text-orange-500"> {crmCount} CRM</span>
          </p>
        </div>
        <div className="sm:ml-auto">
          <Button size="sm" onClick={() => { setInviteOpen(true); setInvMsg(null); }} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Inviter un utilisateur
          </Button>
        </div>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Aucun utilisateur enregistré. Envoyez des invitations pour commencer.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Utilisateur</th>
                <th className="text-center px-4 py-2.5 font-medium">Veille</th>
                <th className="text-center px-4 py-2.5 font-medium">CRM</th>
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Invité le</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.displayName || u.email}</p>
                    {u.displayName && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </td>

                  {/* Veille role */}
                  <td className="px-4 py-3 text-center">
                    <Select
                      value={u.veilleRole || 'none'}
                      onValueChange={v => handleAccessChange(u, 'veilleRole', v === 'none' ? 'lecteur' : v as Role)}
                      disabled={saving}
                    >
                      <SelectTrigger className="w-36 h-7 text-xs mx-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="contributeur">Contributeur</SelectItem>
                        <SelectItem value="lecteur">Lecteur</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>

                  {/* CRM access toggle */}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleAccessChange(u, 'crmAccess', !u.crmAccess)}
                      disabled={saving}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors ${u.crmAccess ? 'bg-orange-100 text-orange-600 hover:bg-orange-200' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    >
                      {u.crmAccess ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                  </td>

                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">{u.invitedAt || '—'}</td>

                  <td className="px-2 py-3">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-2">
        <p className="font-medium">Applications</p>
        <div className="grid sm:grid-cols-2 gap-3 text-muted-foreground">
          <div className="space-y-1">
            <p className="font-medium text-foreground text-xs uppercase tracking-wide">Veille</p>
            <p><strong className="text-foreground">Admin</strong> — lecture, écriture, gestion accès</p>
            <p><strong className="text-foreground">Contributeur</strong> — lecture + écriture</p>
            <p><strong className="text-foreground">Lecteur</strong> — consultation uniquement</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground text-xs uppercase tracking-wide">CRM</p>
            <p><Check className="inline h-3.5 w-3.5 text-orange-500" /> Activé — accès complet au CRM</p>
            <p><X className="inline h-3.5 w-3.5 text-muted-foreground" /> Désactivé — accès refusé au CRM</p>
          </div>
        </div>
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={v => { if (!inviting) setInviteOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Inviter un utilisateur</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Adresse email *</Label>
              <Input id="inv-email" type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} required placeholder="utilisateur@example.com" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Nom d'affichage</Label>
              <Input id="inv-name" value={invName} onChange={e => setInvName(e.target.value)} placeholder="Prénom Nom" />
            </div>

            {/* App access */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Accès aux applications</p>

              {/* Veille */}
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="inv-veille"
                      checked={invVeilleRole !== 'none'}
                      onChange={e => setInvVeilleRole(e.target.checked ? 'contributeur' : 'none')}
                      className="rounded"
                    />
                    <label htmlFor="inv-veille" className="text-sm font-medium cursor-pointer">
                      Veille — Intelligence concurrentielle
                    </label>
                  </div>
                  <Badge variant="default" className="text-xs">veille-alpha.vercel.app</Badge>
                </div>
                {invVeilleRole !== 'none' && (
                  <Select value={invVeilleRole} onValueChange={v => setInvVeilleRole(v as Role)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contributeur">Contributeur — lecture + écriture</SelectItem>
                      <SelectItem value="lecteur">Lecteur — consultation uniquement</SelectItem>
                      <SelectItem value="admin">Admin — accès complet</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* CRM */}
              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="inv-crm"
                      checked={invCrm}
                      onChange={e => setInvCrm(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="inv-crm" className="text-sm font-medium cursor-pointer">
                      CRM — Gestion commerciale
                    </label>
                  </div>
                  <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">crmpool.vercel.app</Badge>
                </div>
              </div>
            </div>

            {invMsg && (
              <p className={`text-sm ${invMsg.type === 'error' ? 'text-destructive' : 'text-green-600'}`}>
                {invMsg.text}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviting}>Annuler</Button>
              <Button type="submit" disabled={inviting || !invEmail.trim()}>
                {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
                Envoyer l'invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Révoquer l'accès ?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{deleteTarget?.displayName || deleteTarget?.email}</strong> perdra l'accès à toutes les applications. Son compte Supabase reste actif.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Annuler</Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Révoquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
