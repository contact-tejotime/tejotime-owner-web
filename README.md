# TejoTime Owner

Monorepo for the TejoTime owner platform. Each app is fully independent — own `package.json`, lockfile, and `node_modules`. Install and run commands inside the app folder.

## Apps

| Folder | Stack | Status |
|--------|-------|--------|
| `frontend/` | Next.js 16, React 19 | Active |
| `app/` | Expo 56, React Native | Active |
| `backend/` | Node/Express API | Not initialized yet |

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

### Backend

```bash
cd backend
# Not set up yet — see backend/README.md
```

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
