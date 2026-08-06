# 18 — Theming Architecture

> **Shipped, with known gaps.** The engine, its self-check, the admin mirror and the sync guard,
> the microsite render path, the admin Appearance editor and the live preview channel are all in
> the repo ([§1](#1-where-the-code-lives), [§10](#10-live-preview)). What has *not* landed is the
> microsite consuming the geometry tokens — radius, density, typography and the hero variants are
> stored and previewed but barely reach the page; see [§11](#11-what-is-still-todo). The parity
> invariant in [§8](#8-the-parity-invariant) is the non-negotiable part: no store's microsite may
> move a pixel because of this work.
>
> **Deploy order:** migrations `0016_business_theme_color.sql` and `0017_business_theme.sql` must
> be applied **before** the backend image goes live — the admin now sends `theme` on every save.
> See [DEPLOY.md](../DEPLOY.md) §5. (Note the duplicate `0016_` prefix: `0016_business_theme_color.sql`
> and the older `0016_fix_queue_add_overload.sql` are both applied and independent. `migrate.ts`
> sorts by filename, so ordering is deterministic; use a strictly increasing prefix from 0018 on.)

Every TejoTime store gets its own microsite at `/{slug}`. Until now every one of them rendered the
same blue: `frontend/src/app/globals.css` hard-codes one palette, and the only per-store escape
hatch was `business.theme_color`, mixed into five `--primary*` variables inline
(`frontend/src/lib/theme-color.ts`). The theme engine generalises that into a **design-token
compiler**: a pure function from a small config object to a complete, contrast-checked,
light-and-dark set of CSS custom properties.

---

## 1. Where the code lives

```
frontend/src/theme/                     ← THE SOURCE OF TRUTH
├── ThemeStyle.tsx                      # server component: <style id="tt-theme">
└── engine/
    ├── index.ts                        # the entire public surface
    ├── types.ts                        # id unions, runtime id arrays, token-name tuples
    ├── defaults.ts                     # LEGACY_/DEFAULT_THEME_CONFIG, normalizeThemeConfig, category map
    ├── resolve.ts                      # config → ResolvedTheme (the whole pipeline)
    ├── css.ts                          # ResolvedTheme → CSS string / style object / attributes
    ├── modifiers.ts                    # radius · shadow · density · animation scales
    ├── typography.ts                   # the six type sets
    ├── hero.ts                         # hero-variant metadata (contract only, no layout)
    ├── color/
    │   ├── oklch.ts                    # sRGB ↔ OKLab ↔ OKLCh, gamut clamp, mixing
    │   ├── ramp.ts                     # seed hex → 10-step ramp, curated built-ins
    │   └── contrast.ts                 # WCAG ratios, onColor, ensureContrast
    ├── presets/                        # minimal · modern · luxury · warm · medical · bold
    └── __tests__/run.ts                # dependency-free self-check (npm run test:theme)

admin-panel/src/theme/engine/           ← GENERATED MIRROR. Never hand-edit.
scripts/sync-theme-engine.mjs           ← dev-only: writes and verifies that mirror
```

### Why it is duplicated instead of shared

Because of how we deploy. `frontend/Dockerfile` and `admin-panel/Dockerfile` each run
`npm ci` → `COPY . .` → `npm run build`, and Railway's **Root Directory is set to the app
folder**, so the Docker build context *is* `frontend/` or *is* `admin-panel/`. A package at the
repo root — `packages/theme`, a root workspace, anything — **does not exist inside either build
context**. It would resolve fine on a developer's laptop and fail the moment it hit Railway. Both
`next.config.ts` files reinforce this by pinning `turbopack.root` and `outputFileTracingRoot` to
`__dirname`, and both `tsconfig.json`s map only `"@/*" → "./src/*"`.

So: **code an app imports must live under that app's folder.** The engine is authored once in
`frontend/`, and `scripts/sync-theme-engine.mjs` copies it byte-for-byte into `admin-panel/`.
`scripts/` itself is safe at the root precisely because no app imports it — it is a dev tool run
by a human or by CI.

| Command | Does |
|---|---|
| `npm run sync:theme` | Copies `frontend/src/theme/engine/**` → `admin-panel/src/theme/engine/**`, minus `__tests__/`; prefixes the mirror's `index.ts` with a DO-NOT-EDIT banner; deletes mirror files with no counterpart in the source. |
| `npm run check:theme` | Same comparison, writes nothing. Exit 0 in sync; exit 1 with a per-file summary (missing / differs at line N / not in source) when stale. **Run this in CI before the admin-panel build.** |
| `npm run test:theme` | Runs the engine self-check (~14.8k assertions) through `tsx` using `backend/`'s toolchain — no new dependency anywhere. |

The banner is deterministic (no timestamps, no hashes) so `--check` can compare bytes. The mirror
is committed, not gitignored: the Docker build never runs npm scripts of its own, so whatever is
in git is what ships.

**The backend does not import the engine either** — same reason, different folder. `backend/`
mirrors the id unions (`preset`, `mode`, `radius`, `shadow`, `density`, `animation`, `heroVariant`)
in its own Zod schema. That is a third copy of six string unions; it is deliberate, and it is
small enough to keep in sync by hand.

---

## 2. The config object

```ts
interface ThemeConfig {
  preset: 'minimal'|'luxury'|'modern'|'bold'|'medical'|'warm';
  mode:   'light'|'dark'|'auto';
  brand:  string;              // '#rrggbb' — seeds the brand ramp
  radius?:      'sharp'|'medium'|'rounded';
  shadow?:      'none'|'soft'|'premium';
  density?:     'comfortable'|'compact';
  animation?:   'subtle'|'normal'|'rich';
  heroVariant?: 'split-classic'|'editorial'|'split-modern'|'full-bleed'|'trust'|'cozy';
  accent?: string;             // '#rrggbb' — overrides the preset's accent strategy
}
```

The five modifier axes are **optional on purpose**. "Unset" is a real, meaningful state: it means
*follow the preset*. A store on `minimal` that switches to `bold` should pick up bold's sharp
corners and compact density — which can only happen if it never pinned `radius: 'medium'` in the
first place. `resolveTheme` fills any gap from `PresetDefinition.defaults` and returns an
`EffectiveThemeConfig` where all five are concrete.

> **Rule for the admin form:** send `radius` / `shadow` / `density` / `animation` / `heroVariant`
> **only** when the control has been moved off its "Preset default" position. Always sending all
> five silently freezes the store on its first preset's personality.

`normalizeThemeConfig(input, base?)` is the boundary between Postgres `jsonb` (arbitrary,
possibly hand-edited, possibly written by an older schema) and everything else. It never throws,
accepts short hex / missing `#` / whitespace, upper-cases the result, drops unknown keys, and
leaves optional keys **absent** rather than `undefined` so the object round-trips through jsonb
cleanly. `resolveTheme` normalises internally, so passing it raw input is safe.

---

## 3. The token contract

The engine emits **120 CSS custom properties**, in three groups.

**Legacy (53)** — every custom property `globals.css` defines today, kept as first-class output
with identical resolved values for the default config. Nothing in `MicrositeClient.tsx` or any
other component has to change to keep working:

```
--primary --primary-hover --primary-active --primary-soft --primary-soft-fg
--secondary --secondary-hover --secondary-soft --secondary-soft-fg
--surface-page --surface-card --surface-sunken --surface-hover --surface-inverse
--text-strong --text-body --text-muted --text-subtle --text-on-brand --text-link
--border-subtle --border-default --border-strong --border-focus
--success --success-soft --success-soft-fg   --warning --warning-soft --warning-soft-fg
--error --error-soft --error-soft-fg         --info --info-soft --info-soft-fg
--brand-ink --brand-accent
--radius-xs --radius-sm --radius-md --radius-lg --radius-xl --radius-pill
--shadow-xs --shadow-sm --shadow-md --shadow-lg --shadow-xl --ring
--control-h-sm --control-h-md --control-h-lg
```

**New (58)** — the vocabulary new work should be written against: the full `--brand-50…900` ramp
plus `--brand`/`-hover`/`-pressed`/`-subtle`/`-subtle-fg`/`-border`/`--on-brand`; the accent set;
`--bg --surface-1 --surface-2 --surface-3 --surface-glass --scrim --on-hero`;
`--hero-from --hero-via --hero-to`; `--text --text-secondary --border --focus-ring`; the spacing
scale `--space-1…8` with `--section-y --card-pad --gap-tight --gap --gap-loose`;
`--font-display --font-body`; and the motion set `--dur-* --ease-* --lift-y --scale-hover`.

**Extra (9)** — engine-only knobs, namespaced away from anything `globals.css` owns:
`--border-w --fw-display --fw-body --fw-label --tracking-display --tracking-body --tracking-label
--label-transform --hero-angle`.

All three name lists are exported as `LEGACY_TOKEN_NAMES`, `NEW_TOKEN_NAMES` and
`EXTRA_TOKEN_NAMES`, and the self-check asserts every one of them is present in both modes.

### How they reach the page

`themeToCss(resolved, selector?)` always emits **three blocks**, never a diff:

```css
[data-tt-theme]                            { …light… }
[data-tt-theme][data-tt-mode="dark"]       { …dark…  }
@media (prefers-color-scheme: dark) {
  [data-tt-theme][data-tt-mode="auto"]     { …dark…  }
}
```

Switching a store between light / dark / auto therefore costs **one attribute write** on the
wrapper: no restyle pass, no re-render, no second request, and no way for server and client to
disagree about which block is active — the DOM attribute is the entire state. Specificity works
out because the dark blocks are `(0,2,0)` against the base's `(0,1,0)`, and the media block comes
last in source order. Cost: ~10.7 KB uncompressed, ~2 KB over the wire.

Because the string goes into `dangerouslySetInnerHTML`, `themeToCss` strips `<>{};\` from every
selector, token name and value, and whitelists token names to `[a-zA-Z0-9_-]`.

The microsite renders it server-side so the **first paint is already themed** — no flash of
default blue:

```tsx
<ThemeStyle config={config} />                        {/* server component, no hooks   */}
<div id="tt-site" {...themeAttributes(resolved)}>…</div>   {/* data-tt-theme + data-tt-mode */}
```

---

## 4. The six presets

A preset is a *personality*: two neutral ramps (light and dark), an accent strategy, a type set,
a hero recipe, a border width, and the default position of the four modifier axes.

| id | Character | Neutrals | Accent | Type set | Defaults (radius / shadow / density / animation) | Hero |
|---|---|---|---|---|---|---|
| `minimal` | Apple/Notion calm. **The parity preset.** | cool slate — *is* `--gray-*` from globals.css | fixed teal `#14b8a6` | geometric (Inter) | medium / soft / comfortable / normal | split-classic |
| `modern` | Tight, monochrome, low motion | neutral zinc | brand ramp step 400 | grotesk | medium / soft / comfortable / subtle | split-modern |
| `luxury` | Warm cream, serif headlines, unhurried | cream | fixed gold `#c9a227` | serif-display | rounded / premium / comfortable / rich | editorial |
| `warm` | Friendly, rounded, humanist | toasted tan | fixed orange `#e07a3f` | friendly | rounded / soft / comfortable / normal | cozy |
| `medical` | Clarity under stress | clean cool grey | fixed green `#10b981` | clinical | medium / soft / comfortable / subtle | trust |
| `bold` | High contrast, 2px rules, uppercase | near black & white | complementary (hue +180°, chroma ×1.15, step 600) | condensed-heavy | sharp / premium / **compact** / rich | full-bleed |

`minimal`'s light neutral ramp is byte-for-byte the `--gray-0…900` scale in `globals.css`, and its
accent is today's `--secondary`. **Editing `presets/minimal.ts` changes every existing store** —
treat that file as frozen.

`PRESET_LIST` is the admin picker order (safest first): minimal, modern, luxury, warm, medical,
bold.

### Category suggestions

`presetForCategory(category)` maps a business category to a starting preset — Salon & Barber →
`luxury`, Hospital → `medical`, Restaurant → `warm`, CrossFit Box → `bold`, Coworking Space →
`modern`, anything unrecognised → `minimal`. It matches **whole words**, not substrings, because
"Coworking Space" contains *spa* and "Hospitality" contains *hospital*; the cost is that plurals
are spelled out in `CATEGORY_PRESETS`.

This is a **new-store affordance only**. It runs in the admin form to pre-fill a picker. Nothing
at render time ever consults it, so re-categorising a store can never change how it looks.

---

## 5. The five modifier axes

| Axis | Values | Moves |
|---|---|---|
| `radius` | `sharp` (2–8px) · `medium` (4–20px) · `rounded` (8–28px) | `--radius-xs…xl` (`pill` is always 999px) |
| `shadow` | `none` · `soft` · `premium` | `--shadow-xs…xl`, `--ring` |
| `density` | `comfortable` · `compact` (~0.85×) | `--control-h-*`, `--space-1…8`, `--section-y`, `--card-pad`, `--gap-*` |
| `animation` | `subtle` · `normal` · `rich` | `--dur-*`, `--ease-emphasis`, `--lift-y`, `--scale-hover` |
| `heroVariant` | 6 variants (see [§10](#10-what-is-still-todo)) | which hero layout renders; the colours already exist as `--hero-*` |

`medium` / `soft` / `comfortable` / `normal` reproduce `globals.css` exactly — do not "tidy" their
numbers.

Two things worth knowing. **Shadows are recipes, not strings**: `modifiers.ts` stores offsets,
blurs and alphas, and `resolve.ts` tints them with the preset's darkest neutral (so a warm theme
casts a warm shadow) and the ring with the store's brand. And **`--ease-standard` is identical
across all three animation scales** — it is already in `globals.css` and half the existing
transitions reference it; only durations and `--ease-emphasis` move.

`density: 'compact'` is the only axis that moves a legacy token's value: `--space-2` is 8px under
`comfortable` (matching `globals.css`) and 6px under `compact`, overriding the `:root` value for
everything inside the themed wrapper. That is the point of the axis.

---

## 6. Light, dark, and auto

Each preset carries two neutral ramps. The dark ramp is **not** the light one reversed — it is
re-tuned so the dark end supplies the four steps a dark UI actually needs (page 900, card 800,
raised 700, rule 600) while the light end supplies text. Surfaces come off the light end in light
mode and the dark end in dark mode; text does the reverse.

Dark mode is not a filter over light mode. Specifics:

- Brand sits at ramp step **600** in light, **400** in dark, so the fill stays legible against the
  page it is painted on.
- Brand / accent / status **"soft" backgrounds are flattened to opaque hexes** (`mixSrgb` against
  the card colour) rather than left as `rgba`, so the contrast maths measures what is actually
  painted.
- `--scrim` is built from the dark neutral, never white-alpha. `--surface-glass` is the card
  colour at 0.72 alpha.
- Elevation shadow alphas are multiplied by 2.2 (capped at 0.75) in dark mode; `--ring` is never
  boosted.

`mode: 'auto'` does not resolve to anything on the server — it selects the media-query block. All
three blocks ship regardless of mode ([§3](#3-the-token-contract)).

Brand-independent by design, in both modes: `--brand-ink` `#102a6b` and `--brand-accent`
`#f5821f` (the TejoTime mark itself), and the entire status scale. `--info` stays blue on a
red-branded store; a red `--error` next to a red brand is a worse outcome than a slight clash.

---

## 7. The contrast engine

Colour maths runs in **OKLCh**, not HSL: equal lightness steps look equal, and hue stays put when
chroma changes. `generateRamp(seed)` places ten stops on a fixed lightness curve at the seed's
hue, clamps chroma into the sRGB gamut per stop, and returns `#rrggbb`. Five common seeds
(including `#2563EB` and the preset accents) short-circuit to hand-tuned `BUILTIN_RAMPS`.

Every mode of every resolved theme carries a `ContrastReport`. Checks are tiered:

| Tier | Min ratio | Gated? | Examples |
|---|---|---|---|
| `body` | 4.5 | yes | body/strong/muted text on page and card |
| `large` | 3 | yes | headline on hero gradient |
| `ui` | 3 | yes | brand fill on page, status colours, focus ring |
| `decorative` | 1 | **no** — reported only | `--text-subtle` on page, accent on card, `--border-default` on card |

`ContrastReport.pass` is true when every check passes, counting `decorative` as passing. **An
admin AA badge must filter to `tier !== 'decorative'`.**

The three decorative pairs exist because gating them would rewrite values the live site already
ships: `--text-subtle` `#94a3b8` on `#f8fafc` is 2.48:1 and `--secondary` `#14b8a6` on white is
2.49:1. They are placeholders and hairlines, not information.

Three more deliberate limits:

- **`minimal` gates text against `--bg` and `--surface-1` only, never `--surface-2`.** `#64748b`
  on `#f1f5f9` is 4.34:1, so including the sunken surface would push `--text-muted` off slate-500
  and change the live site. That pairing *is* rendered (the microsite puts muted text on sunken
  wells), so it is a real shortfall — but it is parity-locked and has to be fixed in the markup,
  not in the engine. **Every other preset does gate on `--surface-2`**, which is what keeps
  `modern` and `warm` from shipping 4.28–4.40:1 muted text; only `--text-muted` moves as a result.
- **`--surface-3` is decorative / fill-only.** Rails, tracks, skeletons, chips. It is deliberately
  not a text backdrop and no text token is gated against it — `--text-muted` lands at 3.38–3.86:1
  there. If a component needs readable text on a raised fill, use `--surface-2`.
- Where a check *would* fail, `ensureContrast` walks the relevant ramp to the nearest step that
  passes rather than inventing a colour. A pale brand therefore resolves `--brand` to a deeper
  version of itself — step 600 must reliably carry a readable label. Store owners can be surprised
  by this; the admin editor should show a "your brand renders as ▢" swatch.

Interactive states are checked as their own pairs. A button keeps one ink across rest / hover /
pressed, so `--on-brand` is gated against `--brand`, `--brand-hover` *and* `--brand-pressed` (and
`--on-accent` against `--accent-hover`). Where the default "walk darker in light mode" direction
would carry the fill toward a dark ink, `stateDirection()` walks the other way instead — but only
when the default actually fails, so nothing that passes today is rewritten.

Headroom is thin in exactly one place: across the full 6-preset × 2-mode × 18-brand sweep the
tightest gated pair is `--warning` `#d97706` on a preset's page background, ~3.02:1 against a 3.0
minimum (`luxury`'s cream is `#fcf9f4` rather than `#faf7f2` precisely because the original was
2.98:1). Darken any preset's neutral-50 or darken the warning colour and that is the first check
to break. It is asserted in `run.ts`, so it fails in CI rather than in production.

---

## 8. The parity invariant

**The live microsite must render identically for every existing store.** This is the constraint
the whole design bends around.

```ts
LEGACY_THEME_CONFIG = Object.freeze({
  preset: 'minimal', mode: 'light', brand: '#2563EB',
  radius: 'medium', shadow: 'soft', density: 'comfortable', animation: 'normal',
});
```

Resolving that config must reproduce, for all 53 legacy tokens, exactly what `globals.css`
resolves to today:

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--primary` | `#2563eb` | | `--surface-page` | `#f8fafc` |
| `--primary-hover` | `#1d4ed8` | | `--surface-card` | `#ffffff` |
| `--primary-active` | `#1e40af` | | `--surface-sunken` | `#f1f5f9` |
| `--primary-soft` | `#eff6ff` | | `--text-strong` | `#0f172a` |
| `--primary-soft-fg` | `#1d4ed8` | | `--text-body` | `#334155` |
| `--secondary` | `#14b8a6` | | `--text-muted` | `#64748b` |
| `--secondary-hover` | `#0d9488` | | `--text-subtle` | `#94a3b8` |
| `--border-subtle` | `#e2e8f0` | | `--radius-md` / `--radius-lg` | `10px` / `14px` |
| `--border-default` | `#cbd5e1` | | `--control-h-md` | `44px` |
| `--shadow-xs` | `0 1px 2px rgba(15, 23, 42, 0.06)` | | | |

`npm run test:theme` asserts this token by token, plus ramp hue stability, gamut containment, the
full contrast sweep, and structural completeness of the token lists — ~14,800 assertions, zero
dependencies. **Run it before merging anything under `frontend/src/theme/`.**

`globals.css` is untouched and stays untouched. It remains the default for every page that is not
inside a themed wrapper (the marketing site, `not-found`, the admin panel's own chrome), and it is
the reference the engine is measured against. Do not remove or rename a property in it.

`DEFAULT_THEME_CONFIG` — what the admin seeds a *new* store with — is `{preset:'minimal',
mode:'light', brand:'#2563EB'}` with the modifiers deliberately unset. It resolves byte-identically
to `LEGACY_THEME_CONFIG` today (asserted), because `minimal`'s own defaults are those same values.
If the default look should ever change, change `DEFAULT_THEME_CONFIG`. Never `LEGACY_THEME_CONFIG`.

### One sanctioned behaviour change

| `theme` | `theme_color` | Result |
|---|---|---|
| NULL | NULL | Byte-identical to today. Proven by the self-check. |
| NULL | `#XXXXXX` | `--primary` and its four relatives now come from the OKLCh ramp instead of `primaryThemeVars`'s sRGB mixing. **They will differ slightly.** |
| set | any | Fully engine-resolved; `theme_color` overrides `theme.brand`. |

The middle row is intentional — one brand hex should produce one ramp everywhere — but it is a
visible change for the handful of stores that set a colour before this shipped. If zero movement
on day one matters more, keep calling `primaryThemeVars` for rows where
`theme IS NULL AND theme_color IS NOT NULL` and drop that branch on the next release.

---

## 9. Persistence and the dual write

Two columns on `business` ([04](./04-data-model.md)):

| Column | Migration | Type | Notes |
|---|---|---|---|
| `theme_color` | `0016_business_theme_color.sql` | `text NULL` | `CHECK (theme_color ~ '^#[0-9A-Fa-f]{6}$')`. The original single-colour feature. |
| `theme` | `0017_business_theme.sql` | `jsonb NULL` | `CHECK (jsonb_typeof(theme) = 'object')`. The full config. **Not backfilled** — existing rows stay NULL. |

Field-level validation lives in the backend Zod schema, not in the database: the check constraint
only guarantees "an object", so an old or hand-edited config can never fail an `INSERT` and can
never crash a render (`normalizeThemeConfig` absorbs it).

**Resolution order at render time:**

```ts
const config = { ...normalizeThemeConfig(site.theme),          // NULL → LEGACY_THEME_CONFIG
                 brand: site.themeColor ?? normalized.brand }; // theme_color still wins
const theme  = resolveTheme(config);
```

`theme_color` deliberately keeps priority. It is the column the Expo owner app and any existing
integration already read, and while both columns exist they must never disagree about the brand.

**The dual write:** when the admin saves a theme it writes `theme` **and** mirrors
`theme.brand` into `theme_color` in the same statement. One transaction, no drift.

**When `theme_color` can be dropped** — all four must hold:

1. Every row with a non-NULL `theme_color` has a `theme` whose `brand` equals it (a backfill, not
   a guess).
2. Nothing reads `themeColor` any more: the public API response, `frontend/src/lib/api.ts`, the
   Expo app in `app/`, and any partner integration.
3. `frontend/src/lib/theme-color.ts` (`isHexColor` / `primaryThemeVars`) and its use in
   `MicrositeClient.tsx` are gone — that module exists only to serve the legacy column.
4. A release has shipped with the column present but unread, so a rollback is still possible.

Then expand/contract it: stop writing → verify → drop. Not before.

---

## 10. Live preview

The admin theme editor previews against the **real microsite**, in an iframe, so what an owner
approves is what ships — no second renderer to keep in sync.

The two message types below are the shipped wire format —
`admin-panel/src/components/appearance/MicrositePreview.tsx` on the sending end,
`frontend/src/theme/usePreviewChannel.ts` on the receiving end. There is no `source` field; the
`type` string is the whole discriminator, and origin checking (not the payload) is the security
boundary.

```
admin-panel (parent)                          frontend (iframe, /{slug}?preview=1)
  │  iframe src = FRONTEND_URL/{slug}?preview=1
  │                                             ← { type:'tt-theme-ready' }
  │                                               posted to each allowed admin origin
  ├─ { type:'tt-theme-preview', config } ─────►  normalize → resolve → setProperty
  │    targetOrigin = FRONTEND_ORIGIN             per-token inline custom properties
  │    (never '*')                                + data-tt-theme / data-tt-mode attrs
```

Rules on both ends, in order:

1. **Check `event.origin` first**, before touching `event.data`. The iframe compares against its
   allowlist (`NEXT_PUBLIC_ADMIN_ORIGIN` plus the two localhost:3001 dev hosts); the parent
   compares against `NEXT_PUBLIC_FRONTEND_URL`'s origin. Anything else is dropped silently — an
   embedded page receives messages from every frame on the page, including extensions and ad
   frames.
2. **Never post with `targetOrigin: '*'`.** A theme config is not secret, but a wildcard target
   means any page that manages to host the frame receives the stream. The `tt-theme-ready`
   handshake is posted once per allowed origin rather than once with `'*'`.
3. **Re-validate the payload.** Check the `type` discriminator, then run the config through
   `normalizeThemeConfig` — the message is untrusted input exactly like the jsonb column is.
4. **Preview mode is opt-in and read-only.** The `?preview=1` route enables the listener and
   nothing else; it never writes to the database, and without the query parameter no listener is
   attached at all (the engine is behind a dynamic `import()`, so it is not even downloaded).
5. Applying an update writes CSS custom properties directly onto the themed wrapper with
   `style.setProperty`, plus the two attributes. No React state, no reload, no refetch — inline
   properties outrank the server-rendered `<style>` block by specificity, which stays intact
   underneath.

Both origins are configuration, not constants — see [14 — Environment Variables](./14-environment-variables.md).
`NEXT_PUBLIC_FRONTEND_URL` already exists in the admin panel; the frontend reads
`NEXT_PUBLIC_ADMIN_ORIGIN`. Neither may fall back to `'*'`.

The admin's own preview panel imports the engine from the **mirror** (`@/theme/engine`) to render
swatches, contrast badges and the AA check locally, without a round trip. That is the entire
reason the mirror exists.

---

## 11. What is still TODO

| Item | Notes |
|---|---|
| **Hero layout variants** | `hero.ts` is contract-only today: six ids, labels and metadata, no components. The colours they need (`--hero-from/via/to`, `--on-hero`, `--hero-angle`) already resolve and are contrast-checked per mode. Until the layouts exist, `heroVariant` is a stored preference with no visual effect. |
| **Component primitives** | `MicrositeClient.tsx` still hard-codes a lot of geometry inline. Button / Card / Badge / Input primitives reading `--radius-*`, `--control-h-*`, `--shadow-*` would let the modifier axes actually reach the page. |
| **Density in inline styles** | Same root cause: `density` moves `--space-*` and `--card-pad`, but inline `padding: 24` ignores them. Compact is under-delivering until those become `var(--card-pad)`. |
| **Admin panel adopting the engine** | The admin chrome still runs on its own `globals.css`. It could resolve `minimal`/`light` for itself and get dark mode for free. |
| **Expo app adopting the engine** | `app/` cannot import CSS variables at all — it needs a `tokensForMode(resolved, mode)` → React Native `StyleSheet` adapter, and a fourth copy of the engine under `app/`. Worth doing only once the axes visibly pay off on the web. |
| **Per-store fonts** | `TYPE_SETS` names families; nothing loads them yet. Self-hosting is required — no external font CDN. |
| **CI wiring** | `npm run check:theme` and `npm run test:theme` must both gate the admin-panel and frontend builds in `.github/workflows/`. The mirror is only honest if something enforces it. |

---

## See also

- [04 — Data Model](./04-data-model.md) — `business.theme_color`, `business.theme`
- [13 — Deployment Architecture](./13-deployment.md) and [DEPLOY.md](../DEPLOY.md) — the per-folder Railway build that forces the mirror
- [14 — Environment Variables](./14-environment-variables.md) — preview origins
- [16 — Backend Folder Structure](./16-folder-structure.md) — where the backend's mirrored Zod id unions belong
