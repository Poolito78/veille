import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { UserPlus, Loader2, Trash2, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRole, listVeilleUsers, setUserRole, removeUser } from '@/lib/roles';
import type { VeilleUser, Role } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Admin() {
  const { isAdmin } = useRole();
  const [users, setUsers] = useState<VeilleUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('contributeur');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail.trim(), {
      redirectTo: `${window.location.origin}/auth`,
      data: { display_name: inviteDisplayName.trim() || undefined },
    });

    if (error) {
      setInviteMsg({ type: 'error', text: error.message });
      setInviting(false);
      return;
    }

    // Insert role row
    if (data.user) {
      await supabase.from('veille_roles').upsert({
        user_id: data.user.id,
        role: inviteRole,
        display_name: inviteDisplayName.trim() || inviteEmail.trim(),
        invited_at: new Date().toISOString(),
      });
    }

    setInviteMsg({ type: 'success', text: `Invitation envoyée à ${inviteEmail}` });
    setInviteEmail('');
    setInviteDisplayName('');
    setInviting(false);

    // Refresh list
    const updated = await listVeilleUsers();
    setUsers(updated);
  }

  async function handleRoleChange(userId: string, role: Role) {
    setSaving(true);
    await setUserRole(userId, role);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    setSaving(false);
  }

  async function handleDelete(user: VeilleUser) {
    setSaving(true);
    await removeUser(user.id);
    setUsers(prev => prev.filter(u => u.id !== user.id));
    setDeleteTarget(null);
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-sm text-muted-foreground">Gérez les accès à l'espace Veille</p>
        </div>
        <div className="sm:ml-auto">
          <Button size="sm" onClick={() => { setInviteOpen(true); setInviteMsg(null); }} className="gap-1.5">
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
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Invité le</th>
                <th className="text-left px-4 py-2.5 font-medium">Rôle</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.displayName || u.email}</p>
                    {u.displayName && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{u.invitedAt || '—'}</td>
                  <td className="px-4 py-3">
                    <Select value={u.role} onValueChange={v => handleRoleChange(u.id, v as Role)} disabled={saving}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="contributeur">Contributeur</SelectItem>
                        <SelectItem value="lecteur">Lecteur</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(u)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Role legend */}
      <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
        <p className="font-medium">Niveaux d'accès</p>
        <div className="space-y-1 text-muted-foreground">
          <p><strong className="text-foreground">Admin</strong> — Accès complet : lecture, écriture, gestion des utilisateurs</p>
          <p><strong className="text-foreground">Contributeur</strong> — Lecture et écriture (fiches, produits, notes)</p>
          <p><strong className="text-foreground">Lecteur</strong> — Consultation uniquement, aucune modification</p>
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
              <Label htmlFor="invite-email">Adresse email *</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="utilisateur@example.com" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Nom d'affichage</Label>
              <Input id="invite-name" value={inviteDisplayName} onChange={e => setInviteDisplayName(e.target.value)} placeholder="Prénom Nom ou pseudo" />
            </div>
            <div className="space-y-1.5">
              <Label>Rôle</Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contributeur">Contributeur — lecture + écriture</SelectItem>
                  <SelectItem value="lecteur">Lecteur — consultation uniquement</SelectItem>
                  <SelectItem value="admin">Admin — accès complet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteMsg && (
              <p className={`text-sm ${inviteMsg.type === 'error' ? 'text-destructive' : 'text-green-600'}`}>
                {inviteMsg.text}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviting}>Annuler</Button>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
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
            <strong>{deleteTarget?.displayName || deleteTarget?.email}</strong> ne pourra plus accéder à l'espace Veille. Cette action ne supprime pas le compte Supabase.
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
