import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  // Diagnostic — visible dans les logs Vercel sans exposer les valeurs
  console.log('[veille build] VITE_ keys present:', {
    GROQ: !!process.env.VITE_GROQ_API_KEY,
    GEMINI: !!process.env.VITE_GEMINI_API_KEY,
    GEMINI_LEN: (process.env.VITE_GEMINI_API_KEY || '').length,
    OPENROUTER: !!process.env.VITE_OPENROUTER_API_KEY,
  });
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: { port: 8090 },
    cacheDir: '/tmp/vite-cache',
    define: {
      // Lecture directe de process.env (injecté par Vercel) — pas via loadEnv
      'import.meta.env.VITE_GROQ_API_KEY': JSON.stringify(process.env.VITE_GROQ_API_KEY || ''),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(process.env.VITE_GEMINI_API_KEY || ''),
      'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(process.env.VITE_OPENROUTER_API_KEY || ''),
    },
  };
});
