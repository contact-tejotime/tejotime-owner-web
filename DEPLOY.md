# Deploying TejoTime on Railway

Everything lives in **one Railway project** so the services share Railway's private network:

| Service | Folder | What it is | Domain |
|---|---|---|---|
| `tejotime-api` | `backend/` | Express + Socket.IO + node-cron | `api.tejotime.com` |
| `tejotime-web` | `frontend/` | Next.js 16 customer microsite (SSR) | `www.tejotime.com` |
| `tejotime-admin` | `admin-panel/` | Next.js admin panel | `admin.tejotime.com` |
| Postgres | — | Railway managed Postgres plugin | — |
| Bucket | — | Railway Buckets (S3-compatible object storage) | — |

Railway runs long-lived processes, so **Socket.IO realtime and the cron jobs work exactly as they do locally** — no serverless degradation, and no free-tier idle spin-down.

All three app services build from their own `Dockerfile`, config-as-code'd via `railway.toml` (`builder = "DOCKERFILE"`) — not Nixpacks, which Railway deprecated in favor of Railpack in March 2026. Only the **Root Directory** and the env vars are set in the dashboard.

> The Expo owner app (`app/`) is a mobile app and is **not** deployed here. Point it at the live API: `EXPO_PUBLIC_API_BASE_URL=https://api.tejotime.com/api/v1`, `EXPO_PUBLIC_SOCKET_URL=https://api.tejotime.com`.

---

## Prerequisites
1. This repo pushed to GitHub.
2. A [Railway](https://railway.com) account.
3. A Railway project containing a **Postgres** plugin and a **Bucket**.
4. A domain with DNS you control (this project: `tejotime.com` on GoDaddy) for the custom domains below.

## Steps

### 1. Create the three app services
For each of `backend`, `frontend`, `admin-panel`: **New → GitHub Repo** → select this repo → in **Settings → Root Directory** enter the folder name. Railway finds that folder's `Dockerfile` via its `railway.toml`.

### 2. Fill each service's environment variables
See `backend/.env.example` and each service's `.env.railway` crib sheet for the full list. The ones that come from other Railway services are best set as **variable references** so they stay in sync:

| Var | Source |
|---|---|
| `DATABASE_URL` (backend) | Postgres service → the **private** url (`postgres.railway.internal`), *not* the public proxy |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (backend) | Bucket → **Credentials** tab |
| `S3_FORCE_PATH_STYLE` (backend) | `true` only if the bucket's Credentials tab says it needs path-style URLs |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_TOKEN_SECRET`, `TICKET_URL_HMAC_SECRET`, `PASSWORD_PEPPER`, `OTP_PEPPER` (backend) | `backend/.env` |

> ⚠️ **`PASSWORD_PEPPER` must match the value used when the DB was seeded.** Owner and admin password hashes are peppered with it — a different value breaks every login. The same applies to `CUSTOMER_TOKEN_SECRET` / `TICKET_URL_HMAC_SECRET` for existing ticket links.

For `frontend` and `admin-panel`, the `NEXT_PUBLIC_*` vars are also declared as `ARG`s in their `Dockerfile`s — Railway doesn't pass service variables into `docker build` by default, so the Dockerfile explicitly opts each one in. Setting them in the dashboard is enough; no extra step.

Leave the cross-URL vars (`APP_BASE_URL`, `PUBLIC_WEB_URL`, `CORS_ALLOWED_ORIGINS`, and the Next apps' `NEXT_PUBLIC_*`) for step 4.

### 3. Domains: generate first, add custom domains once each service is live
**Settings → Networking → Generate Domain** on each of the three app services first — confirms the service actually boots before DNS is in the picture. Then, still in Networking, **+ Custom Domain**:

| Service | Custom domain | GoDaddy record |
|---|---|---|
| `tejotime-api` | `api.tejotime.com` | CNAME `api` → target Railway shows |
| `tejotime-web` | `www.tejotime.com` | CNAME `www` → target Railway shows |
| `tejotime-admin` | `admin.tejotime.com` | CNAME `admin` → target Railway shows |

Each domain shows pending until DNS propagates, then flips to verified (green check) and Railway issues TLS automatically. **Don't paste the custom-domain value into `APP_BASE_URL`/etc. until it's verified** — otherwise the app boots pointing at a domain that doesn't resolve yet; use the `*.up.railway.app` domain as an interim value if you need to deploy sooner.

### 4. Wire the services together, then redeploy
**`tejotime-api`:**
| Var | Value |
|---|---|
| `APP_BASE_URL` | `https://api.tejotime.com` |
| `PUBLIC_WEB_URL` | `https://www.tejotime.com` |
| `CORS_ALLOWED_ORIGINS` | `https://www.tejotime.com,https://admin.tejotime.com` |

**`tejotime-web`:** `NEXT_PUBLIC_API_BASE_URL=https://api.tejotime.com/api/v1`, `NEXT_PUBLIC_SOCKET_URL=https://api.tejotime.com`, `NEXT_PUBLIC_ASSET_PREFIX=https://www.tejotime.com`, `NEXT_PUBLIC_ADMIN_ORIGIN=https://admin.tejotime.com`

> `NEXT_PUBLIC_ADMIN_ORIGIN` is the origin allowed to drive the microsite's live theme preview (`?preview=1`). The code default is already `https://admin.tejotime.com`, so you only need to set it while the admin is on a different host — e.g. the interim `*.up.railway.app` domain in step 3, or a staging deploy. If it is wrong the admin's Appearance preview silently shows "isn't accepting live theme updates".

**`tejotime-admin`:** `BACKEND_API_BASE_URL=https://api.tejotime.com/api/v1`, `NEXT_PUBLIC_FRONTEND_URL=https://www.tejotime.com`

> `NEXT_PUBLIC_*` are **baked in at build time**, so after setting them you must **redeploy** (not just restart) the two Next services.

> `APP_BASE_URL` is load-bearing beyond CORS: it is baked into the `/media/...` URLs stored on every uploaded image. Changing the API domain later means rewriting those stored URLs.

### 5. Database
Migrations are idempotent and safe to re-run. From your machine, against Railway's **public** proxy url (your laptop isn't on the private network):
```bash
cd backend && DATABASE_URL="<public-proxy-url>" npm run migrate
```

> ⚠️ **Run migrations BEFORE promoting a new backend image, not after.** Nothing runs them
> automatically (`backend/Dockerfile` CMD is `node dist/server.js`; `railway.toml` has no
> pre-deploy hook), and a backend that is ahead of its schema fails *writes*, not just reads.
> Concretely for the theming release: the admin panel sends `theme` on every save, so without
> `0016_business_theme_color.sql` + `0017_business_theme.sql` every store create, edit **and the
> enable/disable toggle** 500s with `column "theme" of relation "business" does not exist`.
> Verify before promoting:
> ```bash
> psql "$DATABASE_URL" -c "select column_name from information_schema.columns \
>   where table_name='business' and column_name in ('theme','theme_color')"
> ```

**Never run `npm run seed` against a database with real data** — it deletes and recreates the `sharp-cuts` tenant.

---

## Verify the deployment
```bash
curl https://api.tejotime.com/healthz     # {"status":"ok",...}
curl https://api.tejotime.com/readyz      # {"status":"ok","db":true}
curl https://api.tejotime.com/api/v1/public/businesses/sharp-cuts   # microsite JSON
curl -I https://api.tejotime.com/media/<known-key>   # 302 → a signed bucket URL
```
- Open `https://www.tejotime.com/<store-phone>` → the microsite loads **with images**.
- Open `https://www.tejotime.com/<store-phone>/card` → chooser with **Book an appointment** and **Save contact**.
  - Book → microsite; Save → OS Add-Contact / `.vcf`.
- Owner app Settings → Booking QR encodes `https://www.tejotime.com/<store-phone>/card` (not the raw `.vcf`).
- In DevTools → Network → WS, confirm a `wss://api.tejotime.com/socket.io/` connection upgrades (**101**) → realtime is live.
- Join the queue on the site → a ticket is issued; the live wait/team cards update over the socket.
- API logs should show `Socket.IO initialized` and `Scheduler started` on boot.
- Log into `admin.tejotime.com`, confirm (DevTools → Network) it calls `api.tejotime.com`, not a stale URL.

### Booking QR reprint
After this release, **reprint physical stickers** from the owner app (or admin store hub). Older codes that pointed at the raw `.vcf` URL skip the chooser and open Add-Contact directly. New prints encode `/{phone}/card`.

## Notes
- **No secrets in git** — values live only in the Railway dashboard (and each service's local `.env`/`.env.railway`, which are gitignored).
- **Private networking**: the backend reaches Postgres and the bucket over Railway's internal network. Only the three app services need public domains.
- **Images**: the bucket is private. `GET /media/*` redirects to a short-lived signed URL, so bytes are served by the bucket (free egress) rather than proxied through the API. See [docs/10-file-storage.md](./docs/10-file-storage.md).
- **QR host vars:** keep `PUBLIC_WEB_URL`, `EXPO_PUBLIC_WEB_URL`, and `NEXT_PUBLIC_FRONTEND_URL` on the same origin (`https://www.tejotime.com`). See [docs/14-environment-variables.md](./docs/14-environment-variables.md).