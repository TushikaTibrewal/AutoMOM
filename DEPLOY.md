# Deploying AutoMOM

AutoMOM is two deployable units:

| Unit | What it is | Good host |
|---|---|---|
| **frontend/** | Static React/Vite SPA | **Vercel** (chosen) |
| **backend/** | FastAPI + Postgres + PDF engine | A container host (Render / Railway / Fly / a VPS) |

Vercel is perfect for the SPA. The backend does **not** belong on Vercel serverless: it
needs a persistent Postgres connection and generates PDFs with WeasyPrint (GTK native libs)
or headless Chromium — neither runs in a Vercel function. Deploy the backend as a container,
then point the Vercel frontend at its URL.

---

## 1. Backend (container host)

The repo already has a production Docker stack. On any Docker host (VPS, Render, Railway, Fly):

```bash
cp .env.example .env
# Edit .env — REQUIRED for production:
#   JWT_SECRET_KEY   -> 32+ random chars:  openssl rand -hex 32
#   POSTGRES_PASSWORD-> strong value
#   PUBLIC_ORIGIN    -> your Vercel URL, e.g. https://automom.vercel.app
#   OPENAI_API_KEY   -> optional (mock extractor used if absent)

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The backend refuses to boot in production with a default/weak `JWT_SECRET_KEY`, `DEBUG=true`,
or a localhost CORS origin (see `config.py::validate_for_production`).

Put TLS in front (the host's managed certs, or Caddy/Traefik/nginx). Note the public backend
URL — e.g. `https://api.automom.example.com`.

### Managed PaaS shortcuts
- **Render / Railway:** point the service at `docker/backend.Dockerfile`, add a managed
  Postgres, set the env vars above. Add a Postgres → `DATABASE_URL` (format:
  `postgresql+psycopg2://user:pass@host:5432/db`).
- **Fly.io:** `fly launch` from `docker/backend.Dockerfile`, `fly postgres create`, set secrets
  with `fly secrets set JWT_SECRET_KEY=... `.

---

## 2. Frontend (Vercel)

Config already committed: [frontend/vercel.json](frontend/vercel.json) (SPA rewrites, Vite build).

### Option A — Vercel dashboard (no CLI)
1. Push this repo to GitHub (`gh repo create` or the web UI).
2. Vercel → **New Project** → import the repo.
3. Set **Root Directory** = `frontend`.
4. Add environment variable **`VITE_API_URL`** = your backend URL (from step 1),
   e.g. `https://api.automom.example.com`. **No trailing slash.**
5. Deploy. Vercel auto-detects Vite, runs `npm run build`, serves `dist/`.

### Option B — Vercel CLI
```bash
npm i -g vercel
cd frontend
vercel link
vercel env add VITE_API_URL production   # paste backend URL
vercel --prod
```

The SPA calls the API at `VITE_API_URL` (baked at build time). In local dev the var is empty
and Vite proxies `/api` to `localhost:8000`, so nothing changes for development.

---

## 3. Wire the two together

1. Deploy backend, get its URL.
2. Set `VITE_API_URL` on Vercel to that URL, redeploy the frontend.
3. Set `PUBLIC_ORIGIN` (backend `CORS_ORIGINS`) to the Vercel URL, restart backend.
4. Smoke test: open the Vercel URL, register, create a meeting, generate, export PDF + DOCX.

## Production checklist
- [ ] `JWT_SECRET_KEY` = `openssl rand -hex 32`
- [ ] `POSTGRES_PASSWORD` strong; Postgres port not publicly exposed
- [ ] `DEBUG=false`, `ENVIRONMENT=production`
- [ ] `CORS_ORIGINS` = exact Vercel origin only (no localhost)
- [ ] TLS on the backend
- [ ] `VITE_API_URL` set on Vercel, no trailing slash
- [ ] AI keys set (or accept the deterministic mock extractor)
- [ ] Postgres backups enabled on the host

## Known scaling notes
- Rate limiting (slowapi) is in-memory → correct for a single backend instance. For multiple
  replicas, back it with Redis (`Limiter(storage_uri="redis://...")`).
- Exports are written to a container volume and streamed back immediately; the DB stores only
  metadata. For multi-instance, move exports to object storage (S3/R2).
