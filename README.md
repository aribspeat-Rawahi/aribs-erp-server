# ARIBS ERP – Server

NestJS backend + React (Vite) frontend, deployed together as **one Node.js
app** on Hostinger. The backend serves the built frontend, and every API
route lives under `/api`.

```
backend/    NestJS API  (all routes under /api)
frontend/   React SPA   (built to frontend/dist, served by the backend)
```

The Windows and Android apps live in the separate public repo
[`Aribs-Erp`](https://github.com/aribspeat-Rawahi/Aribs-Erp). They load the
live site, so a deploy here updates them too — no rebuild needed.

## Branches and environments

| Branch    | Deploys to (automatically, on every push) | Database        |
|-----------|-------------------------------------------|-----------------|
| `develop` | staging – `https://staging-erp.aribs.net` | staging DB      |
| `main`    | production – `https://erp.aribs.net`      | production DB   |

Daily flow:

1. Changes are pushed to `develop` → staging updates in 1–2 minutes.
2. Test on staging.
3. When happy, `develop` is merged into `main` → production updates.

Every push also runs the **Build check** GitHub Action. A red ❌ on a commit
means it does not build — never promote that commit to `main`.

## Hostinger setup (one time per environment)

hPanel → **Websites → Add Website → Node.js web app → Import Git repository**

| Setting          | Value                                   |
|------------------|-----------------------------------------|
| Repository       | `aribs-erp-server`                      |
| Branch           | `main` (production) / `develop` (staging) |
| Root directory   | `/` (repo root)                         |
| Node.js version  | 22 (latest 22.x) or 24                  |
| Build command    | `npm run build`                         |
| Start command    | `npm start`  (entry: `backend/dist/main.js`) |

### Environment variables (hPanel → the app → Environment variables)

Secrets live **only** here — never in Git. See `backend/.env.example` for
the full list. Required:

| Variable        | Notes |
|-----------------|-------|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | separate DB for staging |
| `JWT_SECRET`    | long random string, different per environment |
| `DATA_DIR`      | persistent folder **outside** the app, e.g. `/home/<user>/erp-data` (staging: `/home/<user>/erp-data-staging`) |
| `CORS_ALLOWED_ORIGINS` | the site's own URL |

Generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Restart the app after changing any environment variable.

### Why `DATA_DIR` matters

Uploads, invoice PDFs and backups are written relative to the working
directory (paths like `uploads/invoices/...` are also stored in the DB).
A Git deploy rebuilds the app folder, so `DATA_DIR` moves the working
directory to a folder that survives deploys. When moving an existing
server, copy its old `uploads/` folder into `DATA_DIR` first.

## Database changes (migrations)

`synchronize` is permanently **off**. The schema changes only through
migration files in `backend/src/migrations`, which the app runs
**automatically on startup** (each in its own transaction — if one fails,
it is rolled back and the app does not start, so nothing is half-applied).

When an entity changes:

```bash
cd backend
# needs a local database that is at the CURRENT migrations
npm run migration:run
npm run migration:generate -- src/migrations/DescribeTheChange
# review the generated SQL, then commit it together with the entity change
```

Safety nets:
- **Build check** applies all migrations to an empty MariaDB and fails if any
  entity change has no migration (`npm run migration:check`).
- On startup the app logs `Database schema matches the code.` or a warning
  listing differences (read-only — it never changes anything itself).
- The `InitialSchema` baseline is skipped on databases that already existed
  (staging/production) and cannot be reverted.
- Destructive changes (dropping/renaming columns) must be written by hand so
  data is copied first — never accept a generated `DROP COLUMN` blindly.
- The MariaDB/MySQL driver is auto-detected; UUID ids stay `varchar(36)`.

## Local development

```bash
# backend (needs a local MySQL and backend/.env – copy from .env.example)
cd backend && npm install && npm run start:dev      # http://localhost:3000/api

# frontend (talks to http://localhost:3000/api by default)
cd frontend && npm install && npm run dev            # http://localhost:5173

# production-like: build everything and serve from one process
npm run build && npm start
```
