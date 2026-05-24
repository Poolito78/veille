import type { VercelRequest, VercelResponse } from '@vercel/node';

const VEILLE_URL = 'https://veille-alpha.vercel.app';
const CRM_URL = 'https://crmpool.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return res.status(500).json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY)' });
  }

  const { email, veilleRole, crmAccess, displayName } = req.body as {
    email: string;
    veilleRole?: string;   // 'admin' | 'contributeur' | 'lecteur' | null
    crmAccess?: boolean;
    displayName?: string;
  };

  if (!email) return res.status(400).json({ error: 'email requis' });
  if (!veilleRole && !crmAccess) return res.status(400).json({ error: 'Sélectionner au moins une application' });

  // Redirect URL : Veille en priorité, sinon CRM
  const redirectTo = veilleRole ? `${VEILLE_URL}/auth` : `${CRM_URL}/auth`;

  // 1. Inviter l'utilisateur via Supabase Auth
  const inviteResp = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      data: { display_name: displayName || email },
      redirect_to: redirectTo,
    }),
  });

  const inviteData = await inviteResp.json() as { id?: string; email?: string; msg?: string; error?: string };

  if (!inviteResp.ok) {
    // User already exists — still update roles
    if (inviteData.msg?.includes('already') || inviteData.error?.includes('already')) {
      // Look up the existing user
      const userResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      const userData = await userResp.json() as { users?: Array<{ id: string }> };
      const userId = userData.users?.[0]?.id;
      if (!userId) return res.status(400).json({ error: 'Utilisateur introuvable' });
      await upsertRole(supabaseUrl, serviceRoleKey, userId, email, displayName, veilleRole, crmAccess);
      return res.status(200).json({ success: true, existing: true });
    }
    return res.status(inviteResp.status).json({ error: inviteData.msg || inviteData.error || 'Invitation échouée' });
  }

  const userId = inviteData.id;
  if (!userId) return res.status(500).json({ error: 'Pas d\'ID utilisateur retourné' });

  // 2. Insérer/mettre à jour les accès
  await upsertRole(supabaseUrl, serviceRoleKey, userId, email, displayName, veilleRole, crmAccess);

  return res.status(200).json({ success: true, userId, email });
}

async function upsertRole(
  supabaseUrl: string,
  key: string,
  userId: string,
  email: string,
  displayName: string | undefined,
  veilleRole: string | undefined,
  crmAccess: boolean | undefined,
) {
  await fetch(`${supabaseUrl}/rest/v1/veille_roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      email,
      display_name: displayName || email,
      role: veilleRole || 'lecteur',
      crm_access: crmAccess ?? false,
      invited_at: new Date().toISOString(),
    }),
  });
}
