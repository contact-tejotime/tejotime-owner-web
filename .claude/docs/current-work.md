# Current work

**Last updated:** 2026-09-04 · branch `feat-jay`, 4 commits ahead of `main`, working tree clean.

This is the living document. Update it when the state of play changes; the other five docs describe
the system as designed, this one describes where it actually is.

---

## 1. What is in flight

### The U.S. market repositioning (marketing site)

The public site has been rewritten from India-market copy to a U.S. launch, against a client copy
guide. **Shipped** in `bc0b482`:

- Homepage copy replaced wholesale — hero, proof bar, industry cards, feature section, online
  booking, walk-ins, client management, getting started, pricing, FAQ, closing CTA.
- Internal production notes removed from the public site; no `$XX` placeholder pricing anywhere.
  Pricing is Starter (free during the pilot) / Business (**"Coming soon"**) / Multi-location
  (contact us).
- "Walk-ins" reframed as an **optional** walk-in waitlist, because walk-ins don't fit every target
  industry.
- Med-spa and physical-therapy copy carries **no HIPAA, medical-record, insurance, or compliance
  claims** — those capabilities are not verified. Keep it that way.
- The unverified social-proof gallery was replaced with a `ProductTour` component until real pilot
  photography and testimonials exist.
- New routes: `/industries/[slug]` (9 industry pages), `/resources`, `/terms`, `/accessibility`;
  `/privacy` rewritten.

### Legal pages

`/privacy`, `/terms`, `/accessibility` render from `frontend/src/i18n/en.json` through
`components/legal/LegalPage.tsx`. Company-specific facts are `{token}` placeholders resolved from
`t.legal`; **an unfilled token renders as a visible amber marker** so an unverified detail cannot
ship unnoticed.

All four values are now filled:

| Key | Value |
|---|---|
| `entity` | `TejoTime` (confirmed as the name to use) |
| `address` | `4213 Lee Blvd, Lehigh Acres, FL 33971` |
| `supportPhone` | `+1 (239) 506-1324` |
| `governingState` | `the State of Florida` |

There are currently **zero** pending markers on any legal page.

> These are solid, product-accurate drafts, **not attorney-reviewed**. The liability, indemnity and
> governing-law sections in particular should get a lawyer's read before launch.

### Contact details unified across all four apps

`+1 (239) 506-1324` / `4213 Lee Blvd, Lehigh Acres, FL 33971` are now the single source of truth in
`{app,admin-panel,owner-web}/src/lib/support.ts` (`SUPPORT`) and in `frontend`'s `t.legal`. The
previous Indian support number is **gone from the entire monorepo**.

The address renders in the real contact blocks — owner-web support card, the app's support block,
admin login help, and all three legal pages — but deliberately **not** in the compact two-item
strips (app tab bar, login rows), where it would be noise.

---

## 2. Fixes landed alongside

- **`shell()` client/server crash.** `owner-web`-style `shell()` was exported from
  `MarketingChrome.tsx` (`"use client"`) and called by the server-rendered industry and resources
  pages, which **broke the production build**. Extracted to
  `frontend/src/components/landing/shell.ts` with no `"use client"`. `tsc --noEmit` does not catch
  this class of bug — only `npm run build` does.
- **Industry card copy truncation.** `globals.css` clamped `.tj-photo-body` to 2 lines below 680px.
  The new, longer client-approved copy truncated mid-sentence on every phone. Clamp removed.
- **Toast overlapping the closing CTA.** The toast was `position: sticky`, so at the end of the page
  it resolved to its flow position on top of the Start Free / Book a Demo buttons. Now `fixed`, with
  an iOS safe-area inset.
- **Anchor links landing under the sticky header.** Added `scroll-padding-top` (88px desktop, 80px
  mobile).
- **`/terms` horizontal overflow** at 320–360px from a non-wrapping pending-marker chip.

Verified with a scripted audit across **6 viewports × 6 pages**: no horizontal overflow, no clipped
text, no JS errors. Frontend, owner-web and admin-panel all typecheck; frontend builds and lints
clean.

---

## 3. Known gaps, roughly by severity

### Security / correctness

- **`verifyAdminOtp` mints a full 12h admin JWT against a hardcoded constant.** Flag-gated off
  (`OTP_ENABLED=false` everywhere, including production), but it is a complete auth bypass if the
  flag is ever turned on before real OTP verification is implemented.
- Admin tokens are signed with **`JWT_ACCESS_SECRET`, the same secret as owner tokens** — only the
  `typ` claim separates them. A separate secret would be safer.
- Refresh tokens are stored as `sha256(jti)` with **no per-device metadata used** —
  `auth_session.user_agent` / `.ip` exist but are never written, so there is no session list and no
  targeted revoke.
- **Public writes are not idempotent** — the `idempotency_key` table exists but no middleware uses
  it. A double-tapped "join queue" creates two entries.
- **`audit_log` exists but nothing writes to it.**
- `otp_verification`, `payment`, and the payments/SMS webhook handlers are scaffolding only.

### Infrastructure

- **`owner-web/` has no `Dockerfile` and no `railway.toml`** despite `DEPLOY.md` listing a
  `tejotime-owner` service at `business.tejotime.com`. The only app service without
  config-as-code.
- **`owner-web/` has no CI job.** Lint and build it by hand before merging.
- CI does not run `check:theme`, `check:crop`, `check:axes` or `test:theme`, so the four theme
  mirrors can drift silently.
- Migrations are manual and unversioned in deploy — nothing enforces schema-before-image.
- Backend pinned to one replica (see `deployment.md` §4).

### Product

- **Staff `/owner` sockets join a seat room that nothing emits to**, so staff clients silently fall
  back to polling for live queue updates. Seat-scoped emitters are unimplemented.
- Backend still defaults `DEFAULT_CURRENCY` to **`INR`** with prices in paise, and `business.timezone`
  defaults to `Asia/Kolkata`, while the marketing site is now U.S.-facing. **This needs resolving
  before a real U.S. launch** — it is the largest open inconsistency in the codebase.

### Documentation / structure

- `docs/00`–`docs/18` describe a stack that was never built (Prisma, Redis, BullMQ, Supabase).
  Accurate for the data model, error catalog and role matrix; actively misleading for the stack.
  `DEPLOY.md` and `docs/qa-report-*.md` are current.
- Six-plus utility modules duplicated across the web apps **by hand with no sync guard** —
  `countries.ts`, `phone.ts`, `format.ts`, `support.ts`, `frontend-url.ts`, `PhoneField`, `i18n`.
- i18n migration is partial; `owner-web` in particular still has many inline strings.
- Duplicate migration prefix `0016`. Use `0023+` going forward.

---

## 4. Testing reality

Thin, and worth being honest about:

- `backend/tests/unit/` — **5 vitest files (~565 lines)**, covering **pure functions only**:
  `queue-engine`, `eta-notify`, `ttl-cache`, `whatsapp`, `whatsapp-webhook`.
- `frontend/src/theme/engine/__tests__/run.ts` — framework-free theme self-check.
- `backend/scripts/smoke-rest.mjs` / `smoke-socket.mjs` — end-to-end smoke against a running,
  seeded server.

**No route or integration tests, no DB tests, no frontend or mobile tests, no coverage gate.**
`supertest` is a devDependency but unused. Permission guards, tenant scoping, the plpgsql
functions and the BFF proxies are verified only by smoke scripts and manual QA
(`docs/qa-report-2026-07-10.md`).

Practical consequence: when you change a guard, a scope, or a `queue_*` function, **exercise it
manually or extend the smoke scripts** — nothing else will catch a regression.

---

## 5. Suggested next steps

1. Resolve the **currency/timezone mismatch** (`INR`/`Asia/Kolkata` defaults vs a U.S. launch).
2. Add `owner-web` **`Dockerfile` + `railway.toml` + a CI job** — it is deployed but unconfigured.
3. Wire the four guard scripts into CI so theme mirrors cannot drift.
4. Get the legal pages **attorney-reviewed** before launch.
5. Implement real admin OTP, or remove `verifyAdminOtp` entirely rather than leaving a
   flag-gated bypass in the tree.
