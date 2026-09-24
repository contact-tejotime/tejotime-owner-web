# Owner web: live queue and appointments

**Shipped 2026-09-24.**

## The problem

A customer who checks in from the microsite appeared on the mobile app straight away. On the web
dashboard (`business.tejotime.com`) they only appeared after a hard refresh.

The backend was already doing its part. A public join emits `queue:entry.created` and
`queue:snapshot` to the `business:{id}` room on the `/owner` socket, and the mobile app listens
there. owner-web had never been connected:
- it had no socket client and no polling;
- `NEXT_PUBLIC_SOCKET_URL` was documented as "not wired up yet".

Its pages are Server Components that render once.

## Why a ticket, not the access token

owner-web is a BFF. The access token is an **httpOnly cookie**, so browser JS cannot read it to
put it in the socket handshake. A route that handed it to JS would undo the point of the cookie.

Instead, the backend mints a **socket ticket** (`POST /auth/socket-ticket`):
- It is a JWT with `typ: 'socket'`, valid for 60 seconds.
- It carries `sub`, `bid`, `role` and `sid`, all taken from the caller's token and never from
  the request body.
- The `/owner` handshake accepts an access token (mobile) or a ticket (web).
- `authenticate` accepts only `typ: 'access'`, so a stolen ticket cannot call the REST API. It
  also expires within a minute.

## How the web client works

`owner-web/src/components/LiveRefresh.tsx`:

1. `POST /api/realtime/ticket` (a same-origin BFF route) → backend `/auth/socket-ticket`.
2. Connect to `${NEXT_PUBLIC_SOCKET_URL}/owner` with the ticket. `auth` is a function, so a fresh
   ticket is fetched on **every reconnect**.
3. When a listed event arrives, run a debounced (300ms) `router.refresh()`. The page re-reads
   from the server, so the header count ("3 waiting") updates along with the board.
4. It also refreshes when the tab becomes visible again.

It falls back to **polling every 15s**, while the tab is visible, when:
- `NEXT_PUBLIC_SOCKET_URL` is not set;
- the socket cannot connect (CORS, API down, ticket refused). It goes back to the socket when the
  connection recovers;
- the user is a **staff** login. Staff sockets join a seat room that nothing emits to yet, which
  is the same limitation the app has.

| Page | Events |
|---|---|
| Dashboard (queue board) | `queue:snapshot`, `appointment:checked_in` |
| Appointments, Calendar | `appointment:created`, `appointment:updated`, `appointment:checked_in` |

Settings pages are deliberately left out, because refreshing a form mid-edit would be surprising.

## Staying connected all day (web and mobile)

A dashboard can sit untouched for 15 minutes, 45 minutes or hours. Two things keep the connection
usable the whole time.

### Two things that never end a connection

- **Idle time.** The server pings every 25s (`pingInterval`, pinned in `realtime/io.ts`). That
  stops proxies from closing a quiet connection, and it detects a dead peer within about 45s.
- **An expiring credential.** The token or ticket is checked **only at the handshake**. An open
  socket outlives its 60s ticket or its 15-minute access token.

### What used to end it, and the fix

Socket.IO retries ordinary drops by itself: sleep, Wi‑Fi changes, deploys, proxy cuts. There are
two cases where it **gives up for good** (`socket.active === false`):
- the server refused the handshake;
- the server kicked the client (`"io server disconnect"`).

The **mobile app** hit the first case every day:
- It put the access token captured at sign-in into the handshake.
- 15 minutes later that token had expired.
- On the next drop, the reconnect was refused, and live updates stopped until the app restarted.

The fixes:
- **Mobile.** `connectOwner` now takes a token *getter*, so every reconnect sends the current
  token. On a refusal or a server kick, `store.tsx` refreshes the session (`refreshSession`,
  shared so the REST 401 path and the socket never rotate the refresh token twice) and re-dials
  with backoff (2s up to 30s). When the app returns to the foreground it re-dials immediately and
  re-reads the queue. After any reconnect it re-reads the queue and appointments, because events
  sent while offline are lost.
- **Web.** `LiveRefresh` fetches a fresh ticket on every reconnect. On a refusal or a server kick
  it re-dials with backoff. It re-dials immediately when the tab becomes visible or the browser
  comes back `online`. It polls every 15s while disconnected.

`backend/tests/unit/owner-socket-lifecycle.test.ts` pins this contract with a real server and a
real client:
- a connection outlives its ticket;
- a dropped connection reconnects with a fresh credential;
- an expired-token reconnect is refused and not retried (the old mobile failure), and a manual
  re-dial recovers it;
- a kicked connection recovers the same way;
- a staff ticket never receives the whole-shop snapshot.

## Deploying

- **Backend:** no migration. Deploy it before owner-web, or at the same time.
- **Backend `CORS_ALLOWED_ORIGINS`** must include the owner-web origin:
  `https://business-preprod.tejotime.com` or `https://business.tejotime.com`. owner-web never
  called the API from the browser before, so these may be missing. If they are, the socket fails
  CORS and the pages quietly poll instead.
- **owner-web:** set the build variable `NEXT_PUBLIC_SOCKET_URL`
  (`https://api-preprod.tejotime.com` or `https://api.tejotime.com`) and **redeploy**. A restart
  is not enough, because the value is baked in at build time.

## Surfaces

The mobile app (iOS and Android) already listened on the socket and needs no change. This change
brings owner-web to parity.

## Tests

- `backend/tests/unit/socket-ticket.test.ts` (vitest + supertest, no DB) checks that:
  - a ticket is minted from the caller's token;
  - the endpoint needs auth;
  - a ticket is refused as a REST bearer;
  - the socket verifier accepts only `access` or `socket` tokens;
  - an expired ticket is rejected.
- `backend/scripts/smoke-socket.mjs`, section "OWNER-WEB SOCKET TICKET" (end-to-end), checks that:
  - a ticket socket receives a `queue:snapshot` containing a microsite check-in;
  - the ticket used as a Bearer on `/auth/me` returns 401.
