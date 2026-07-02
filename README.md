# TejoTime Owner

Monorepo for the TejoTime owner platform. Each app is fully independent — own `package.json`, lockfile, and `node_modules`. Install and run commands inside the app folder.

## Apps

| Folder | Stack | Status |
|--------|-------|--------|
| `frontend/` | Next.js 16, React 19 | Active |
| `app/` | Expo 56, React Native | Active |
| `backend/` | Express + Supabase + Socket.IO (TypeScript) | Active |

## Development

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Mobile (Expo)

```bash
cd app
npm install
npm start
```

### Backend (Express + Supabase + Socket.IO)

```bash
cd backend
npm install
npm run migrate   # apply schema + functions to Supabase
npm run seed      # load the Sharp Cuts demo tenant
npm run dev       # http://localhost:8080
```

Demo owner login: `sharpcuts` / `password123`. See [backend/README.md](backend/README.md)
and the full specification in [docs/](docs/).

## Running the full stack

The web and mobile apps talk to the backend over REST + Socket.IO. Start the backend first, then either client — both default to `http://localhost:8080` and are configurable:

```bash
# 1. API (must be running for the apps to work)
cd backend && npm install && npm run migrate && npm run seed && npm run dev

# 2. Customer salon site → http://localhost:3000/sharp-cuts
cd frontend && npm install && npm run dev

# 3. Owner app (login: sharpcuts / password123)
cd app && npm install && npm run web      # or: npm run ios / npm run android
```

API base URLs (override in `frontend/.env.local` and via `EXPO_PUBLIC_*`):
- `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SOCKET_URL`
- `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SOCKET_URL`

> Device note: an Android emulator reaches the host at `http://10.0.2.2:8080`, and a physical device needs your machine's LAN IP — set the `EXPO_PUBLIC_*` vars accordingly.

## Root scripts (optional)

From the repo root you can run convenience scripts without installing app dependencies at the root:

```bash
npm run dev:frontend
npm run dev:app
npm run build:frontend
npm run lint:frontend
npm run lint:app
```

## Monorepo rules

- Run `npm install` / `npm ci` inside each app folder, not at the repo root.
- Each app keeps its own `package-lock.json`.
- No shared workspaces or hoisted dependencies — avoids version conflicts between web and mobile.
