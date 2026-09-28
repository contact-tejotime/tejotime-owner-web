# Admin panel: Save as draft

The admin panel's **Create store** form is long (hours, services, staff, photos, Q&A, appearance).
An admin pulled away mid-way used to come back to an empty form. A **draft** is that form, parked.

Scope: **admin panel + backend only.** owner-web and the mobile app have no Create store form, so the
§11.1 "owner surfaces move together" rule does not apply.

## Behaviour

| Action | Result |
|---|---|
| Type into a fresh Create store form and leave | **Nothing is stored.** A draft exists only because the admin asked for one. |
| Click **Save as draft** (next to *Save & create store*) | The form is saved as a new draft, with no validation (a draft may be incomplete). The page reopens as that draft (`/?draft=<id>`) and it appears under **Drafts (N)** in the sidebar, above **Stores**. |
| Open a draft from the sidebar | The same Create store page, pre-filled. A banner says it is a draft, shows the autosave state and offers **Discard draft**. |
| Edit an open draft | **Autosaves** ~1.5 s after the last keystroke. It also flushes immediately when the tab is hidden, the page is closed, or the admin navigates away. |
| **Save & create store** from a draft | The store is created, then the draft is deleted. If the create fails, the draft is kept and autosave carries on. |
| **Discard draft** | Confirms, deletes it, returns to a blank form. |

- **Private per admin.** An owner does not see their employees' drafts and vice versa. Another
  admin's draft id answers **404**, the same as one that never existed.
- **The owner password is never stored.** The panel strips it before sending and the backend strips it
  again, so a plaintext secret cannot sit in a jsonb column or a backup. A restored draft has an empty
  password field, with a hint to re-enter it before creating the store.
- **Images are URLs.** They upload the moment they are picked, so a draft holds URLs only. Images
  uploaded into a draft that is then discarded stay in the bucket (the same as abandoning the form today).
- **Up to 50 drafts per admin** (`409 DRAFT_LIMIT` beyond that).
- **A draft deleted elsewhere is not resurrected.** Autosave into a draft that no longer exists gets a
  404; the banner says autosave has stopped and *Save as draft* makes a new one.

## Pieces

| Where | What |
|---|---|
| `backend/db/migrations/0031_store_draft.sql` | `store_draft(id, admin_id → admins on delete cascade, name, data jsonb, created_at, updated_at)` |
| `backend/src/modules/admin/store-draft.service.ts` | list / get / create / update / delete, every query scoped on `admin_id`; strips the password; 50 cap |
| `backend/src/modules/admin/admin.routes.ts` | `GET/POST /admin/store-drafts`, `GET/PUT/DELETE /admin/store-drafts/:id` |
| `admin-panel/src/app/api/store-drafts/**` + `lib/draft-proxy.ts` | BFF routes (attach the admin JWT server-side) |
| `admin-panel/src/lib/types.ts` | `draftData()` (form → what is stored), `draftToForm()` (stored blob → safe form state) |
| `admin-panel/src/app/(protected)/page.tsx` | reads `?draft=`, renders `StoreForm` with `key={draft id}` |
| `admin-panel/src/components/StoreForm.tsx` | Save as draft button, banner, autosave + flush effects |
| `admin-panel/src/components/Sidebar.tsx` | the Drafts group |

## Why it is built this way

- **Server-side, not localStorage.** The admin id is not available to client code (the session is an
  httpOnly cookie), and a server draft survives a cleared browser or a second device.
- **The blob is loose on purpose.** `data` is *not* checked against `storeFieldsSchema` — a draft is
  incomplete by definition. Those rules run when it is finally submitted as a store. Only a size cap
  (256 KB) applies.
- **`draftToForm` never trusts the blob.** A draft saved by an older build lacks fields added since,
  and a field of the wrong type would crash a controlled input or a `.map`. Each key is taken only if its
  type matches the blank form's; theme goes through `normalizeThemeConfig`; missing weekdays are filled.
- **The page `key` is the draft id.** Two drafts open one after another are the same route, so without
  it React would keep the first draft's `useState`. The consequence: right after the first *Save as
  draft* the form remounts from what was just saved (a few hundred ms; the button is busy meanwhile).
- **Saves are serialised** through one promise chain, and a queued save reads the latest form when its
  turn comes, so a burst of edits during a slow request becomes one follow-up write.
- **Opening a draft never writes.** The "last saved" baseline is seeded from the form as opened.

## Tests

- `backend/tests/unit/store-drafts.test.ts` (vitest + supertest, DB stubbed): auth on every route,
  password never reaches the SQL, 50-cap, validation, the scoping id passed to every by-id query,
  idempotent delete.
- `backend/scripts/smoke-store-drafts.mjs` (real API + migrated DB): the full lifecycle over HTTP, and
  the cross-admin privacy cases with two logins. Cleans up after itself.
- `npm run test:draft` (root): `draftData` / `draftToForm` — password exclusion, round trip, old-shape
  and wrong-type blobs.
- **No browser test.** The debounce, the tab-hide flush, the sidebar refresh and the remount after the
  first save are verified by hand only (there is no browser runner, §12.2).

## Deploying

Migration `0031` must run **before** the new backend image is promoted (`docs/deploy-hostinger-coolify.md`):
the routes read and write `store_draft`, so a backend ahead of its schema fails on `/admin/store-drafts`.
The sidebar degrades to no Drafts group if that read fails.
