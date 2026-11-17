# Scraft CRM

Lead management and pre-CRM: capture leads from forms, webhooks and Facebook Lead Ads, work them in a deal pipeline, and reply over WhatsApp and Instagram. Multi-workspace, with owner, admin and member roles.

- **Frontend:** React 19, TypeScript, Vite, React Router 7, Tailwind
- **Backend:** Express 5 on Node 20, run with `tsx`
- **Database:** NoCodeBackend (`api.nocodebackend.com`, instance `54182_scraft_crm_database`)

## Run locally

```bash
npm ci --ignore-scripts   # install without running package install scripts
npm run server            # API on http://localhost:3006
npm run dev               # app on http://localhost:3000 (proxies /api to 3006)
```

Run both commands together. Settings come from `.env` (and `.env.local`, which wins). Both are git-ignored.

### Environment

| Variable | Needed for |
|---|---|
| `API_KEY` | NoCodeBackend database. Required. |
| `JWT_SECRET` | Signing login tokens. Required. |
| `VITE_API_BASE_URL` | Leave empty locally to use the Vite proxy |
| `EMAILIT_API_KEY`, `EMAILIT_FROM` | Sending email |
| `REOON_API_KEY` | Email verification |
| `GROQ_API_KEY`, `XAI_API_KEY` | AI assistant |
| `FACEBOOK_*`, `WHATSAPP_*`, `INSTAGRAM_*` | Those integrations |
| `CLOUDINARY_*` | Media uploads |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run server` / `npm start` | Express API |
| `npm run build` | Frontend build to `dist/` |
| `npm run build:server` | Server build to `dist-server/` |

## Structure

| Path | Contents |
|---|---|
| `App.tsx`, `index.tsx` | Routes and entry point |
| `components/`, `pages/`, `contexts/`, `lib/` | Frontend UI, pages, auth and workspace state, API client |
| `server.ts`, `server.js` | API entry (`server.js` launches `server.ts` for Coolify) |
| `routes/`, `services/`, `middleware/`, `utils/`, `types/`, `workers/` | Backend routes, business logic, auth and workspace guards, background jobs |
| `scripts/` | Smoke tests, end-to-end checks and maintenance scripts |
| `docs/` | Feature notes, `api/` (NoCodeBackend spec), `deploy/` (nginx example) |

## Notes

- Auth is JWT in `localStorage` (`scraft_*` keys), refreshed five minutes before expiry.
- Leads are soft-deleted (`deleted_at`) and purged after seven days by a server job.
- `Dockerfile` builds a Node 20 Alpine image that serves on port 3006.
- `.github/workflows/repository-safety.yml` blocks known malware loaders on every push. Keep it.
