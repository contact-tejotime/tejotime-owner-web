# TejoTime Owner Web (business portal)

Web portal for **business owners and staff** at `business.tejotime.com`.

- **Look:** same visual language as the admin panel
- **Features:** same areas as the owner mobile app (queue, appointments, customers, settings, …)
- **This phase:** UI only with mock login and sample data

## Run locally

```bash
cd owner-web
npm install
npm run dev
```

Open [http://localhost:3002](http://localhost:3002).

## Demo login

Any phone with **10+ digits** and password with **4+ characters** signs you in as a mock owner for “Sharp Cut Salon”.

Use the **Demo role** dropdown in the sidebar to preview **Owner / Manager / Staff** navigation:

| Area | Owner | Manager | Staff |
|------|-------|---------|-------|
| Dashboard, Queue, Appointments, Calendar, Customers | yes | yes | yes |
| Settings (most) | yes | yes | no |
| Settings → Profile | yes | yes | yes |

Staff opening a restricted settings URL sees a **No access** page.

## Responsive

- **Desktop (>1024px):** sidebar + same screens
- **Tablet & phone:** bottom nav only (no drawer) — screens match the **owner mobile app** layout (headers, cards, queue seats, settings groups, calendar month, walk-in sheet)

## Later (not in this phase)

- Real auth against the TejoTime API (same as the Expo owner app)
- Live queue / Socket.IO
- Deploy on Railway + DNS for `business.tejotime.com`
