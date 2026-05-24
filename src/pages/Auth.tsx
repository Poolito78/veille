import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'login' | 'reset' | 'set-password';

const RESET_COOLDOWN = 60; // secondes

export default function Auth() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldown(RESET_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  // Detect password-recovery flow from email link
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('type=invite')) {
      setMode('set-password');
    }
  }, []);

  useEffect(() => {
    if (session && mode !== 'set-password') {
      navigate('/fiches', { replace: true });
    }
  }, [session, mode, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage({ type: 'error', text: 'Email ou mot de passe incorrect.' });
    }
    setLoading(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) {
      const isRateLimit = error.message.toLowerCase().includes('rate limit') || error.status === 429;
      setMessage({
        type: 'error',
        text: isRateLimit
          ? 'Trop de tentatives. Attendez avant de réessayer.'
          : error.message,
      });
    } else {
      setMessage({ type: 'success', text: 'Email envoyé ! Vérifiez votre boîte mail.' });
    }
    startCooldown();
    setLoading(false);
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Les mots de passe ne correspondent pas.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Mot de passe défini. Redirection…' });
      setTimeout(() => navigate('/fiches', { replace: true }), 1500);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="p-3 rounded-2xl bg-primary/10">
            <Eye className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Veille</h1>
            <p className="text-sm text-muted-foreground">Intelligence concurrentielle</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
          {mode === 'login' && (
            <>
              <h2 className="text-lg font-semibold">Connexion</h2>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
                </div>
                {message && (
                  <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-600'}`}>
                    {message.text}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Se connecter
                </Button>
              </form>
              <button
                type="button"
                onClick={() => { setMode('reset'); setMessage(null); }}
                className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
              >
                Mot de passe oublié ?
              </button>
            </>
          )}

          {mode === 'reset' && (
            <>
              <h2 className="text-lg font-semibold">Réinitialiser le mot de passe</h2>
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email-reset">Email</Label>
                  <Input id="email-reset" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                {message && (
                  <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-600'}`}>
                    {message.text}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading || cooldown > 0}>
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : cooldown > 0
                      ? `Réessayer dans ${cooldown}s`
                      : 'Envoyer le lien'
                  }
                </Button>
              </form>
              <button
                type="button"
                onClick={() => { setMode('login'); setMessage(null); setCooldown(0); }}
                className="text-sm text-muted-foreground hover:text-foreground w-full text-center"
              >
                ← Retour à la connexion
              </button>
            </>
          )}

          {mode === 'set-password' && (
            <>
              <h2 className="text-lg font-semibold">Définir votre mot de passe</h2>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">Nouveau mot de passe</Label>
                  <Input id="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
                  <Input id="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
                </div>
                {message && (
                  <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-600'}`}>
                    {message.text}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Valider
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Accès sur invitation uniquement.
        </p>
      </div>
    </div>
  );
}
