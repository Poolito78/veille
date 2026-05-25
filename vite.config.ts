import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  const groqKey = process.env.VITE_GROQ_API_KEY || '';
  const geminiKey = process.env.VITE_GEMINI_API_KEY || '';
  const openrouterKey = process.env.VITE_OPENROUTER_API_KEY || '';

  // Diagnostic — visible dans les logs Vercel sans exposer les valeurs
  console.log('[veille build] VITE_ keys present:', {
    GROQ: !!groqKey,
    GEMINI: !!geminiKey,
    GEMINI_LEN: geminiKey.length,
    OPENROUTER: !!openrouterKey,
  });

  return {
    plugins: [
      react(),
      // Plugin transform : injecte les clés API directement dans le source
      // de Produits.tsx au moment de la transformation (avant mise en cache).
      // Rolldown 8 : le `define` standard ne substitue pas les identifiants
      // globaux custom avant le calcul du hash de bundle → valeurs perdues.
      {
        name: 'inject-api-keys',
        transform(code: string, id: string) {
          if (!id.includes('src/pages/Produits')) return;
          return code
            .replace(/__GROQ_KEY__/g, JSON.stringify(groqKey))
            .replace(/__GEMINI_KEY__/g, JSON.stringify(geminiKey))
            .replace(/__OPENROUTER_KEY__/g, JSON.stringify(openrouterKey));
        },
      },
    ],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: { port: 8090 },
    cacheDir: '/tmp/vite-cache',
  };
});
