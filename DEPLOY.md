# Deploying TejoTime on Railway

Everything lives in **one Railway project** so the services share Railway's private network:

| Service | Folder | What it is |
|---|---|---|
| `tejotime-api` | `backend/` | Express + Socket.IO + node-cron |
| `tejotime-web` | `frontend/` | Next.js 16 customer microsite (SSR) |
| `tejotime-admin` | `admin-panel/` | Next.js admin panel |
| Postgres | — | Railway managed Postgres plugin |
| Bucket | — | Railway Buckets (S3-compatible object storage) |

Railway runs long-lived processes, so **Socket.IO realtime and the cron jobs work exactly as they do locally** — no serverless degradation, and no free-tier idle spin-down.

Each app service's build/start/healthcheck config is versioned in its own `railway.toml`; only the **Root Directory** and the env vars are set in the dashboard.

> The Expo owner app (`app/`) is a mobile app and is **not** deployed here. To point it at this API, set `EXPO_PUBLIC_API_BASE_URL=https://<api-domain>/api/v1` and `EXPO_PUBLIC_SOCKET_URL=https://<api-domain>` when you build it.

---

## Prerequisites
1. This repo pushed to GitHub.
2. A [Railway](https://railway.com) account.
3. A Railway project containing a **Postgres** plugin and a **Bucket**.

## Steps

### 1. Create the three app services
For each of `backend`, `frontend`, `admin-panel`: **New → GitHub Repo** → select this repo → in **Settings → Root Directory** enter the folder name. Railway picks up that folder's `railway.toml` for the build and start commands.

### 2. Fill the backend's environment variables
See [`backend/.env.example`](./backend/.env.example) for the full list. The ones that come from other Railway services are best set as **variable references** so they stay in sync:

| Var | Source |
|---|---|
| `DATABASE_URL` | Postgres service → the **private** url (`postgres.railway.internal`), *not* the public proxy |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Bucket → **Credentials** tab |
| `S3_FORCE_PATH_STYLE` | `true` only if the bucket's Credentials tab says it needs path-style URLs |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `backend/.env` |
| `CUSTOMER_TOKEN_SECRET`, `TICKET_URL_HMAC_SECRET` | `backend/.env` |
| `PASSWORD_PEPPER`, `OTP_PEPPER` | `backend/.env` |

> ⚠️ **`PASSWORD_PEPPER` must match the value used when the DB was seeded.** Owner and admin password hashes are peppered with it — a different value breaks every login. The same applies to `CUSTOMER_TOKEN_SECRET` / `TICKET_URL_HMAC_SECRET` for existing ticket links.

Leave the cross-URL vars (`APP_BASE_URL`, `PUBLIC_WEB_URL`, `CORS_ALLOWED_ORIGINS`, and the Next apps' `NEXT_PUBLIC_*`) for step 4.

### 3. Generate public domains
**Settings → Networking → Generate Domain** on each of the three app services, and note the URLs.

### 4. Wire the services together, then redeploy
**`tejotime-api`:**
| Var | Value |
|---|---|
| `APP_BASE_URL` | `https://<api-domain>` |
| `PUBLIC_WEB_URL` | `https://<web-domain>` |
| `CORS_ALLOWED_ORIGINS` | `https://<web-domain>,https://<admin-domain>` |

**`tejotime-web`:** `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api/v1`, `NEXT_PUBLIC_SOCKET_URL=https://<api-domain>`, `NEXT_PUBLIC_ASSET_PREFIX=https://<web-domain>`

**`tejotime-admin`:** `BACKEND_API_BASE_URL=https://<api-domain>/api/v1`, `NEXT_PUBLIC_FRONTEND_URL=https://<web-domain>`

> `NEXT_PUBLIC_*` are **baked in at build time**, so after setting them you must **redeploy** (not just restart) the two Next services.

> `APP_BASE_URL` is load-bearing beyond CORS: it is baked into the `/media/...` URLs stored on every uploaded image. Changing the API domain later means rewriting those stored URLs.

### 5. Database
Migrations are idempotent and safe to re-run. From your machine, against Railway's **public** proxy url (your laptop isn't on the private network):
```bash
cd backend && DATABASE_URL="<public-proxy-url>" npm run migrate
```
**Never run `npm run seed` against a database with real data** — it deletes and recreates the `sharp-cuts` tenant.

---

## Verify the deployment
```bash
curl https://<api-domain>/healthz     # {"status":"ok",...}
curl https://<api-domain>/readyz      # {"status":"ok","db":true}
curl https://<api-domain>/api/v1/public/businesses/sharp-cuts   # microsite JSON
curl -I https://<api-domain>/media/<known-key>   # 302 → a signed bucket URL
```
- Open `https://<web-domain>/<store-phone>` → the microsite loads **with images**.
- In DevTools → Network → WS, confirm a `wss://<api-domain>/socket.io/` connection upgrades (**101**) → realtime is live.
- Join the queue on the site → a ticket is issued; the live wait/team cards update over the socket.
- API logs should show `Socket.IO initialized` and `Scheduler started` on boot.

## Notes
- **No secrets in git** — values live only in the Railway dashboard (and your local `backend/.env`, which is gitignored).
- **Private networking**: the backend reaches Postgres and the bucket over Railway's internal network. Only the three app services need public domains.
- **Images**: the bucket is private. `GET /media/*` redirects to a short-lived signed URL, so bytes are served by the bucket (free egress) rather than proxied through the API. See [docs/10-file-storage.md](./docs/10-file-storage.md).
