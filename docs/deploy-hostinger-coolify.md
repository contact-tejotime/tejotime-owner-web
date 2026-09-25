# Deploying on Hostinger (Coolify) — CI/CD

Production and preprod run on a **Hostinger VPS managed by Coolify**. Coolify builds and runs the
containers and holds the runtime env vars; **GitHub Actions is the gate in front of it** — nothing
deploys until CI passes. This replaces Railway's GitHub auto-deploy described in
[`DEPLOY.md`](../DEPLOY.md) (the URL wiring, migration rules and verification steps there still
apply).

| Branch | GitHub Environment | Domains |
|---|---|---|
| `main` | `production` | `api.` / `www.` / `admin.` / `business.tejotime.com` |
| `preprod` | `preprod` | `api-preprod.` / `preprod.` / `admin-preprod.` / `business-preprod.tejotime.com` |

## How a release flows

```
push to main / preprod
  └─ deploy.yml
       ├─ ci.yml (reused)   lint + build (+ backend build/test) for each changed app
       │                    any failure → stop, nothing is deployed
       └─ deploy job        (environment = production | preprod)
            1. api   → Coolify deploy → wait "finished" → GET /healthz, GET /readyz
            2. web, admin, owner (only the changed ones) → deploy in parallel → wait → GET / , /login
```

- Only apps whose folder changed are deployed. `app/` (mobile) is never deployed here — it ships via EAS.
- **Backend first, alone.** If the API deploy or its health check fails, the web apps are not deployed.
- One deploy per branch at a time; a running deploy is never cancelled by a newer push (it queues).
- **Manual redeploy:** Actions → *Deploy (Hostinger / Coolify)* → *Run workflow*, choose the
  branch, list the apps (`api web admin owner`). This runs CI on all of them first.
- Pull requests still run only `ci.yml` (now including an **owner-web** job, which was missing).

Files: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml),
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
[`.github/scripts/coolify-deploy.sh`](../.github/scripts/coolify-deploy.sh).

## One-time setup

### 1. Coolify (on the VPS)

For each of the 8 applications (4 apps × 2 environments):

1. **Turn Auto Deploy off** (Application → Advanced → *Auto Deploy*). Otherwise every push deploys
   twice — once ungated by Coolify's GitHub webhook, once by Actions after CI.
2. Keep the branch set correctly (`main` for production apps, `preprod` for preprod apps) — Coolify
   builds whatever that branch's head is when Actions calls it.
3. Base directory: `/backend`, `/frontend`, `/admin-panel`, `/owner-web`.
4. `NEXT_PUBLIC_*` variables must be ticked **Build Variable** — they are baked in at build time.
5. Copy the application's **UUID** (in its URL / General tab) — needed for GitHub below.

**Backend migrations** — set the API application's **Pre-deployment command** to:

```
npx --yes tsx db/migrate.ts
```

Migrations are idempotent (`schema_migrations`), and must run **before** the new backend serves
traffic — a backend ahead of its schema fails writes. The image keeps `db/` and `src/` for exactly
this (see `backend/Dockerfile`); `tsx` is a dev dependency, so `npx --yes` fetches it at run time.
After the first deploy, confirm in the Coolify deployment log that the migrate step ran.

**API token** — Coolify → *Keys & Tokens* → *API tokens* → create one with **deploy** permission
(read + deploy is enough). The Coolify API must be reachable from GitHub's runners over HTTPS.

### 2. GitHub

**Repository secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Value |
|---|---|
| `COOLIFY_URL` | Coolify dashboard origin, e.g. `https://coolify.tejotime.com` (no trailing `/api`) |
| `COOLIFY_TOKEN` | the API token from step 1 |

**Environments** (Settings → Environments) — create `production` and `preprod`, each with these
**variables**:

| Variable | production | preprod |
|---|---|---|
| `COOLIFY_UUID_API` | UUID of prod API app | UUID of preprod API app |
| `COOLIFY_UUID_WEB` | … frontend | … |
| `COOLIFY_UUID_ADMIN` | … admin-panel | … |
| `COOLIFY_UUID_OWNER` | … owner-web | … |
| `API_URL` | `https://api.tejotime.com` | `https://api-preprod.tejotime.com` |
| `WEB_URL` | `https://www.tejotime.com` | `https://preprod.tejotime.com` |
| `ADMIN_URL` | `https://admin.tejotime.com` | `https://admin-preprod.tejotime.com` |
| `OWNER_URL` | `https://business.tejotime.com` | `https://business-preprod.tejotime.com` |

Recommended: on `production`, add **Required reviewers** so a merge to `main` waits for a click
before it deploys, and restrict it to the `main` branch.

### 3. Retire Railway

Once Hostinger serves all four domains, disconnect the GitHub repo from the Railway services (or
turn their auto-deploy off) so merges stop deploying there as well. The `railway.toml` files are
then unused; they are left in place until Railway is shut down.

## When a deploy fails

- **CI job red** — nothing was deployed; fix and push again.
- **`Coolify deployment … ended as 'failed'`** — open that deployment's log in Coolify (build error,
  or the pre-deployment migration failed). Coolify keeps the previous container running.
- **`answered '502'` / `'000'` after deploy** — the container started but is not serving: check
  the app's runtime logs and env vars in Coolify. For the API, `/readyz` failing means Postgres is
  unreachable (`DATABASE_URL`).
- **Missing variable** errors name the exact GitHub Environment variable to set.

Rollback: in Coolify, redeploy the previous deployment of that app. Migrations are not rolled
back — they are written to be additive.
