# owner-web — i18n

**Status: complete.** Every user-facing string in `owner-web/src` is served from
`src/i18n/en.json` via the `t` object. This file was previously a work list; the work is done.

## How it works

`src/i18n/index.ts` exports:

- `t` — the dictionary, read straight off `en.json`. Plain object, so it works identically in
  Server and Client Components with no provider.
- `format(template, vars)` — fills `{placeholder}` tokens.
- `plural(count, one, many, vars)` — picks a template by count, then interpolates.

Matches the setup in `app/src/i18n/` and `admin-panel/src/i18n/`. To add a language, drop a
`fr.json` with the same shape next to `en.json` and select it in `index.ts`.

## Conventions

- One group per screen or component (`queue`, `team`, `profile`, `stats`, …); shared words live
  in `common`.
- Interpolate with `{name}`-style placeholders and `format`, never string concatenation — word
  order changes between languages.
- API route handlers use `t.api.*` for messages that reach a client.
- `src/components/appearance/appearanceCopy.ts` is a thin re-export kept for its existing call
  sites; the strings themselves are in `en.json` under `appearance`.

## Deliberately not in en.json

Not user-facing, and moving them would be wrong:

- Keyboard key names compared against `event.key` — `"Escape"`, `"Enter"`, `"ArrowRight"`,
  `"Home"`, `"End"`. These are DOM contract values, not copy.
- HTTP header values (`` `Bearer ${token}` ``), MIME types, CSS strings (`scale(...)`).
- `src/lib/countries.ts` and `src/lib/currencies.ts` — reference data tables.
- Phone-formatting templates in `src/lib/phone.ts` (number layout, not prose).

## Keeping it clean

The scanner that drove this migration lives outside the repo, but the cheap guard is an ESLint
rule: `react/jsx-no-literals`, or a `no-restricted-syntax` entry matching JSX text nodes. Without
one, inline strings creep back within a few PRs.
