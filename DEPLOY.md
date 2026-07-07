# Deploying TejoTime on Render

Deploys **two persistent Node web services** from the [`render.yaml`](./render.yaml) Blueprint:

| Service | Folder | What it is | URL (example) |
|---|---|---|---|
| `tejotime-api` | `backend/` | Express + Socket.IO + node-cron | `https://tejotime-api.onrender.com` |
| `tejotime-web` | `frontend/` | Next.js 16 customer microsite (SSR) | `https://tejotime-web.onrender.com` |

Render runs long-lived processes, so **Socket.IO realtime and the cron jobs work exactly as they do locally** — no serverless degradation. Supabase is the database (already provisioned + migrated).

> The Expo owner app (`app/`) is a mobile app and is **not** deployed here. To point it at this API, set `EXPO_PUBLIC_API_BASE_URL=https://tejotime-api.onrender.com/api/v1` and `EXPO_PUBLIC_SOCKET_URL=https://tejotime-api.onrender.com` when you build it.

---

## Prerequisites
1. This repo pushed to GitHub/GitLab.
2. A [Render](https://render.com) account.
3. The Supabase project keys — already in [`backend/.env`](./backend/.env).

## Steps

### 1. Commit & push
```bash
git add render.yaml DEPLOY.md frontend/package.json
git commit -m "chore: add Render deployment config"
git push
```

### 2. Create the Blueprint
Render dashboard → **New → Blueprint** → select this repo → Render reads `render.yaml` and shows both services. Because every secret is `sync: false`, Render prompts you to fill them in (nothing sensitive is committed).

### 3. Fill the environment variables
**Copy the secret values verbatim from [`backend/.env`](./backend/.env)** into `tejotime-api`:

| Var | Source |
|---|---|
| `SUPABASE_URL` | `backend/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` |
| `DATABASE_URL` | `backend/.env` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `backend/.env` |
| `CUSTOMER_TOKEN_SECRET`, `TICKET_URL_HMAC_SECRET` | `backend/.env` |
| `PASSWORD_PEPPER`, `OTP_PEPPER` | `backend/.env` |

> ⚠️ **`PASSWORD_PEPPER` must match the value used when the DB was seeded** (i.e. the one in `backend/.env`). The demo owner's password hash is peppered with it — a different value breaks the `sharpcuts` / `password123` login. The same applies to `CUSTOMER_TOKEN_SECRET` / `TICKET_URL_HMAC_SECRET` for existing ticket links.

Leave the cross-URL vars (`APP_BASE_URL`, `PUBLIC_WEB_URL`, `CORS_ALLOWED_ORIGINS`, and the web's `NEXT_PUBLIC_*`) for step 5. Click **Apply** to create and build both services.

### 4. Note the assigned URLs
After the first build, note each service's `*.onrender.com` URL (they match the service names if available: `tejotime-api`, `tejotime-web`).

### 5. Wire the two services together, then redeploy
Set these using the real URLs from step 4:

**`tejotime-api`:**
| Var | Value |
|---|---|
| `APP_BASE_URL` | `https://tejotime-api.onrender.com` |
| `PUBLIC_WEB_URL` | `https://tejotime-web.onrender.com` |
| `CORS_ALLOWED_ORIGINS` | `https://tejotime-web.onrender.com` |

**`tejotime-web`:**
| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://tejotime-api.onrender.com/api/v1` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://tejotime-api.onrender.com` |

> `NEXT_PUBLIC_*` are **baked into the frontend at build time**, so after setting them you must **Manual Deploy → Clear build cache & deploy** the `tejotime-web` service. Saving the API's `CORS_ALLOWED_ORIGINS` restarts the API automatically.

### 6. Database (only for a brand-new DB)
The shared Supabase is already migrated. If you point at a fresh DB, run migrations once — from the API service's **Shell**, or locally:
```bash
cd backend && npm run migrate     # idempotent; safe to re-run
```
**Do not run `npm run seed` in production** — it resets tenant data. (The demo "Sharp Cuts" tenant already exists.)

---

## Verify the deployment
```bash
curl https://tejotime-api.onrender.com/healthz     # {"status":"ok",...}
curl https://tejotime-api.onrender.com/readyz      # {"status":"ok","db":true}
curl https://tejotime-api.onrender.com/api/v1/public/businesses/sharp-cuts   # microsite JSON
```
- Open `https://tejotime-web.onrender.com/sharp-cuts` → the microsite loads.
- In browser DevTools → Network → WS, confirm a `wss://tejotime-api.onrender.com/socket.io/` connection upgrades (**101**) → realtime is live.
- Join the queue on the site → a ticket is issued; the live wait/team cards update over the socket.
- API logs should show `Socket.IO initialized` and `Scheduler started` on boot.

## Caveats
- **Free tier sleeps after ~15 min idle** → ~50s cold start on the next request, and `node-cron` is paused while asleep. For always-on realtime + reliable cron, upgrade the API to a paid **Starter** instance, or move the three jobs (stale-cleanup / otp-purge / session-purge) to Render **Cron Jobs**.
- **No secrets in git** — `render.yaml` uses `sync: false` for every secret; values live only in the Render dashboard.
- **Alternative:** the frontend can instead be hosted on **Vercel** (root directory `frontend`, same two `NEXT_PUBLIC_*` vars) with the API staying on Render. Render-for-both keeps everything in one dashboard.
