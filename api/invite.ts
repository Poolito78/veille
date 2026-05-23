import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    return res.status(500).json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY)' });
  }

  const { email, role, displayName } = req.body as { email: string; role: string; displayName?: string };

  if (!email || !role) {
    return res.status(400).json({ error: 'email and role are required' });
  }

  // 1. Invite the user via Supabase Auth admin API
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
      redirect_to: `${req.headers.origin || 'https://veille-alpha.vercel.app'}/auth`,
    }),
  });

  const inviteData = await inviteResp.json() as { id?: string; email?: string; error?: string; msg?: string };

  if (!inviteResp.ok) {
    return res.status(inviteResp.status).json({ error: inviteData.msg || inviteData.error || 'Invitation failed' });
  }

  const userId = inviteData.id;
  if (!userId) {
    return res.status(500).json({ error: 'No user ID returned from invite' });
  }

  // 2. Insert role into veille_roles
  const roleResp = await fetch(`${supabaseUrl}/rest/v1/veille_roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      role,
      display_name: displayName || email,
      invited_at: new Date().toISOString(),
    }),
  });

  if (!roleResp.ok) {
    const roleErr = await roleResp.text();
    return res.status(500).json({ error: `User invited but role insert failed: ${roleErr}` });
  }

  return res.status(200).json({ success: true, userId, email });
}
