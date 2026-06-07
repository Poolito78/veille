# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Dev server (Vite)
npm run build     # tsc -b && vite build (full type-check + bundle)
npm run lint      # ESLint
npm run preview   # Preview production build locally
```

No test suite configured.

## Architecture

**Stack:** Vite 8 + React 19 + TypeScript 6 + Tailwind v3 + shadcn/ui (Radix) + Supabase + React Router v7 + Vercel.

**Relation avec crmpool :** Veille est une extension standalone du projet CRM (`Poolito78/crmpool`). Les deux apps partagent le même projet Supabase (`qkjxcfosutclnahvxflf`) — même Auth, même DB, mêmes tables `concurrents` / `concurrent_produits` / `concurrent_notes`. La page `VeilleConcurrence.tsx` de crmpool lit les mêmes données. Les accès sont gérés depuis le panel Admin de Veille via `veille_roles` (colonne `crm_access` pour l'accès CRM, `role` pour l'accès Veille).

**Deployed to:** `veille-alpha.vercel.app` — push to `master` triggers auto-deploy. CRM déployé sur `crmpool.vercel.app`.

---

### Auth & access model

Invitation-only. `AuthProvider` (`src/hooks/useAuth.tsx`) wraps the app and exposes `{ session, user, loading, signOut }` via `useAuth()`.

Access is gated at two levels:

| Level | Where | How |
|---|---|---|
| **Veille access** | `src/lib/roles.ts` → `useRole()` | Queries `veille_roles.role` for current user |
| **Admin-only UI** | `Layout.tsx` NAV + `Admin.tsx` | `isAdmin` from `useRole()` |

`useRole()` returns `{ role, isAdmin, canEdit }`. Use `canEdit` (admin OR contributeur) to guard write operations. All reads are available to every authenticated user.

---

### Data layer — `useConcurrents()`

All domain data lives in `src/lib/concurrents.ts`. The single hook `useConcurrents()` loads and manages three entity types in parallel at mount:

- `concurrents` ← table `concurrents`
- `produits` ← table `concurrent_produits`
- `notes` ← table `concurrent_notes`

Each entity has a pair of mapping functions (`dbToX` / `xToDb`) that are the **only** place touching raw DB column names (snake_case ↔ camelCase). Mutations update local state optimistically after a successful Supabase call.

`formatCreateur(emailOrName)` resolves an email to a display name cached in `localStorage` under key `veille_creator_names`.

---

### Pages

| Page | Route | Role |
|---|---|---|
| `Fiches.tsx` | `/fiches` | Competitor cards, expandable, CRUD dialog |
| `Produits.tsx` | `/produits` | Competitor product catalog + AI import (PDF/Excel) |
| `Notes.tsx` | `/notes` | Free-form notes per competitor |
| `Pivot.tsx` | `/pivot` | Cross-competitor price comparison table, filterable by category |
| `Admin.tsx` | `/admin` | User management: invite, set Veille role, toggle CRM access |
| `Auth.tsx` | `/auth` | Login, forgot-password (60s rate-limit cooldown), set-password |

---

### AI product import (`Produits.tsx`)

PDF and Excel tariffs are parsed client-side, then sent to an LLM with a fixed extraction prompt. Provider fallback chain: **Groq → Gemini → OpenRouter**. Keys come from `VITE_GROQ_API_KEY`, `VITE_GEMINI_API_KEY`, `VITE_OPENROUTER_API_KEY` env vars (any subset is fine; missing keys skip that provider).

**Key injection — critical Vite 8 / Rolldown quirk:** `define` does NOT work for custom globals in Rolldown 8 — the hash is computed before substitution, so injected values are lost. Instead, a custom `transform` plugin in `vite.config.ts` replaces `__GROQ_KEY__` / `__GEMINI_KEY__` / `__OPENROUTER_KEY__` directly in the `Produits.tsx` source at transform time. `src/globals.d.ts` declares these for TypeScript. Never switch back to `define` for these keys.

**Gemini API key source matters:** Keys created via the Google Cloud Console have `limit: 0` on all free-tier Gemini models (`gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-1.5-flash`). Keys must be created at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) to get the free tier (15 RPM, 1 M tokens/day). **Groq is the recommended primary provider** — create a free key at [console.groq.com/keys](https://console.groq.com/keys), model `llama-3.3-70b-versatile`.

**Current model:** `gemini-2.0-flash-lite` (v1beta). `gemini-1.5-flash` was removed from the v1beta endpoint.

PDF text extraction uses `pdfjs-dist` with a bundled worker:
```ts
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
```

---

### Serverless API

`api/invite.ts` — Vercel serverless function (Node.js). Requires env vars:
- `SUPABASE_SERVICE_ROLE_KEY` — **server-side only**, never VITE-prefixed
- `VITE_SUPABASE_URL`

Handles: invite new user via Supabase Auth admin endpoint, upsert row in `veille_roles`. If the user already exists, looks them up and updates their roles. Redirect URL: `veille-alpha.vercel.app/auth` for Veille invites, `crmpool.vercel.app/auth` for CRM-only invites.

---

### Supabase tables

| Table | Key columns |
|---|---|
| `veille_roles` | `user_id`, `role` (admin/contributeur/lecteur), `email`, `crm_access`, `display_name`, `invited_at` |
| `concurrents` | `id`, `nom`, `site_web`, `notes`, `created_by`, `created_by_email` |
| `concurrent_produits` | `id`, `concurrent_id`, `nom`, `reference`, `categorie`, `quantite`, `prix_ht`, `client_id`, `client_nom`, `informateur`, `date_renseignement`, `created_by_email` |
| `concurrent_notes` | `id`, `concurrent_id`, `titre`, `contenu`, `source`, `date_note`, `created_by_email` |

**RLS on `veille_roles`:** uses a `security definer` function `get_my_veille_role()` to avoid recursive policy evaluation. Never replace admin policies with inline subqueries on `veille_roles` — it causes infinite recursion.

---

### TypeScript 6 conventions

`verbatimModuleSyntax` is enabled — all type-only imports **must** use `import type`:
```ts
import type { ReactNode } from 'react';   // ✅
import { ReactNode } from 'react';        // ❌ build error
```

Path alias `@/` → `src/` (configured in `tsconfig.app.json` with `baseUrl` + `paths` + `ignoreDeprecations: "6.0"`).

---

### Git / deploy

- Repo: `Poolito78/veille` on GitHub, branch `master`
- **Never push automatically** — always ask for confirmation first
- `vercel.json` rewrites all non-`/api/` routes to `index.html` (SPA routing)
