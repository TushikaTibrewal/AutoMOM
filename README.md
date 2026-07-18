# AutoMOM

Messy meeting notes in. Professional Minutes of Meeting out.

AutoMOM converts raw meeting notes (typed, dictated, pasted or uploaded) into professionally
formatted MoM documents. Its core design rule: **the LLM never decides formatting**. The AI
performs structured information extraction only; a deterministic Jinja2 template engine owns
every pixel of the output.

```
Messy notes ──► AI extraction ──► Validated JSON (Pydantic) ──► Template engine ──► PDF / DOCX / Print
```

## Features

- **Meeting information** — title, date, time, venue, organization, type, prepared/approved by
- **Attendees** — dynamic, virtualized table; grouped as Chairperson / Faculty / Core Team / Members / Guests
- **Meeting input** — large editor with typed notes, browser speech-to-text dictation, paste, transcript upload (`.txt/.md/.vtt/.srt`), live character count
- **AI extraction** — GPT-4.1 (via Instructor) or Gemini 2.5 Pro; strict JSON schema, automatic validation + repair retries, prompt versioning, confidence score; offline deterministic mock extractor when no API key is set
- **Deterministic templates** — agenda numbering (1, 1.1, 1.2), role-grouped attendee tables, decision tables, action-item tables, header/footer, org logo; add templates by dropping a folder into `backend/templates/`
- **Editable preview** — rename/move/delete agenda, edit discussion points, decisions and action items, undo/redo (Ctrl+Z / Ctrl+Y), debounced autosave, live document preview
- **Export** — PDF (WeasyPrint), DOCX (python-docx), browser print
- **SaaS UI** — sidebar navigation, dark mode, responsive, Framer Motion transitions, skeleton loaders, toasts
- **Platform** — JWT auth, rate limiting, meeting history + search, recent exports, revision history, audit logs

## Quick start (Docker — recommended)

```bash
cp .env.example .env          # set JWT_SECRET_KEY and (optionally) OPENAI_API_KEY
docker compose up --build
```

- Frontend: http://localhost:3000
- API + docs: http://localhost:8000/docs
- PostgreSQL data persists in the `pgdata` volume.

Without an `OPENAI_API_KEY`/`GEMINI_API_KEY` the app still works fully using the built-in
deterministic mock extractor (useful for demos and development).

## Local development

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows   (source .venv/bin/activate on Unix)
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Defaults to SQLite (`backend/automom.db`) — no Postgres needed locally. Configure via
`backend/.env` (see `.env.example`).

> **Windows note:** PDF export has two backends (see `PDF_ENGINE`). WeasyPrint needs GTK
> native libraries (present in the Docker image, gives page-number footers). On bare Windows,
> use the Chromium backend instead — no system libraries, renders the same HTML/CSS as the
> preview:
>
> ```bash
> pip install playwright
> playwright install chromium
> ```
>
> The service auto-selects whichever backend is available; DOCX export and preview work regardless.

### Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :8000
```

### Tests

```bash
cd backend
pytest tests -q               # 27 tests: auth, schema validation, template engine, full pipeline
```

## Project structure

```
automom/
├─ backend/
│  ├─ app/
│  │  ├─ api/          # routers: auth, generate, meetings, export, templates, transcribe
│  │  ├─ models/       # SQLAlchemy: User, Meeting, Attendee, Template, Export, AuditLog
│  │  ├─ schemas/      # Pydantic: MomExtraction (AI contract), meeting/auth DTOs
│  │  ├─ services/     # extractor (AI), template_engine, pdf_service, docx_service
│  │  ├─ prompts/      # versioned extraction prompts
│  │  └─ utils/        # security (JWT), sanitize, audit, logging
│  ├─ templates/       # template folders (classic, modern, + your own)
│  ├─ exports/         # generated files
│  └─ tests/
├─ frontend/           # React 18 + TypeScript + Vite + Tailwind + shadcn-style UI
├─ docker/             # backend/frontend Dockerfiles, nginx.conf
└─ docker-compose.yml  # db + backend + frontend
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` `/api/auth/login` | JWT auth |
| POST | `/api/generate` | transcript → validated JSON → HTML preview (rate limited) |
| POST | `/api/preview` | re-render preview from edited JSON (no AI call) |
| POST | `/api/transcribe` | upload transcript file → clean text |
| GET/PATCH/DELETE | `/api/meetings[/{id}]` | history, search (`?q=`), autosave, delete |
| GET | `/api/meetings/{id}/revisions` | revision history |
| POST | `/api/export/pdf` `/api/export/docx` | file downloads |
| GET | `/api/exports/recent` | last 20 exports |
| GET | `/api/templates` | discover template folders |
| POST | `/api/template/upload` | install template zip (validated) |

Interactive docs at `/docs` (Swagger) and `/redoc`.

## Adding a template

Create a zip (or folder under `backend/templates/`) containing:

```
mytemplate/
├─ meta.json        {"name": "...", "description": "...", "version": "1.0.0"}
├─ template.html    Jinja2 — receives meeting, attendee_groups, agenda (pre-numbered),
│                   decisions, action_items, summary, styles, logo_data_uri
├─ styles.css       optional, injected as {{ styles }}
└─ logo.png         optional, exposed as base64 data URI
```

All numbering/grouping is computed in Python (`services/template_engine.py::build_context`)
before rendering, so templates only lay out data — never compute it. Jinja2 autoescape is on.

## AI safety & determinism

1. Transcript is sanitized (bleach) and injection phrases are defanged before prompting.
2. The prompt fences the transcript and instructs the model that its content is data, not instructions.
3. Output must validate against `MomExtraction`; Instructor retries with the validation error on failure (repair loop), Gemini path retries manually.
4. Schema validators strip markdown/HTML from every string field — plain text only reaches templates.
5. Missing info ⇒ `null`, never invented.

## Environment variables

See [.env.example](.env.example). Key ones: `DATABASE_URL`, `JWT_SECRET_KEY`, `AI_PROVIDER`
(`auto`/`openai`/`gemini`/`mock`), `OPENAI_API_KEY`, `GEMINI_API_KEY`, `RATE_LIMIT_GENERATE`.

## Security

- JWT bearer auth, bcrypt password hashing, per-user data isolation
- slowapi rate limiting (auth, generate, global)
- bleach HTML stripping + Jinja2 autoescape + schema-level markup stripping
- Upload validation: extension allowlist, size caps, zip-slip protection on template upload
- Audit log of auth, generation, exports, deletions
