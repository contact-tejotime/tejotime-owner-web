# Archive Theme Adoption — Styles & Navigation

Reference for structural improvements adopted from the sport-eco (Archive) project, with design tokens from the TejoTime handoff and Plus Jakarta Sans as the sole font.

## Three-Way Split

| Layer | Source | What we take |
|-------|--------|--------------|
| **Design tokens** | `handoff/tokens/*.css` | Colors, spacing, radii, shadows, type scale |
| **Font family** | `Plus_Jakarta_Sans.zip` | Plus Jakarta Sans only — not handoff Inter |
| **Coding structure** | Archive (sport-eco) | `styles/` folder, `components/common/`, Expo Router groups |

**Rule:** Handoff defines *what* things look like; Archive defines *how* code is organized.

---

## Handoff → `tokens.ts` Mapping

| Handoff CSS | `tokens.ts` export |
|-------------|-------------------|
| `colors.css` primitives | `palette` |
| `colors.css` + `dark.css` semantic aliases | `lightColors`, `darkColors` |
| `spacing.css` `--space-*` | `space` |
| `spacing.css` `--radius-*` | `radius` (+ `circle`) |
| `spacing.css` `--shadow-*` | `shadow` |
| `spacing.css` `--control-h-*` | `controlHeight` |
| `spacing.css` layout tokens | `layout` |
| `typography.css` `--fs-*` | `fontSize` |
| `typography.css` `--lh-*` | `lineHeight` |
| `typography.css` `--ls-*` | `letterSpacing` |
| `typography.css` `--text-*` | `textStyle` presets |
| `colors.css` `--ring` | `ring` |
| `spacing.css` motion | `motion` |
| `fonts.css` (Inter) | `fontFamily` → **Jakarta override** |

---

## Structural Adoption Checklist

### Styles (`src/styles/`)

- [x] `flex.ts` — flex, flexRow, rowCenter, rowSpaceBetween, itemsCenter, wrap, shrink
- [x] `margin.ts` — mt/mb/ml/mr/mh/mv from `space` scale
- [x] `padding.ts` — pt/pb/pl/pr/ph/pv from `space` scale
- [x] `gap.ts` — g0–g10 from `space` tokens
- [x] `typography.ts` — Jakarta weights + handoff fs/lh/ls
- [x] `commonStyle.ts` — mainContainer, innerContainer, textCenter, screenPadding
- [x] `border.ts` — `useBorder()` theme-aware hook
- [x] `index.ts` — merged `styles` export

### Common components (`src/components/common/`)

- [x] `Text.tsx` — variant prop (h1–caption), semantic colors
- [x] `Header.tsx` — from chrome.tsx
- [x] `SectionTitle.tsx`
- [x] `ScreenScroll.tsx`
- [x] `SafeAreaScreen.tsx`

### Navigation (Expo Router)

- [x] `(auth)/login` — unauthenticated stack
- [x] `(app)/(tabs)/*` — five tab routes
- [x] Auth guard at router level
- [x] `BottomNav` wired to `router.push()` + `usePathname()`
- [x] Global overlays in `(app)/_layout.tsx`
- [x] Removed `store.tab` / `OwnerApp.tsx`

---

## What NOT to Adopt

| Item | Reason |
|------|--------|
| Redux Toolkit | Context store stays for now |
| Archive `S*` prefix / RNPaper | Keep existing component names |
| Archive `Colors.ts` / WorkSans | Handoff + Jakarta instead |
| Handoff `*.reference.js` | Reference only |
| Handoff Inter fonts | Jakarta only |
| `moderateScale(0..100)` spacing | Handoff 4px grid |
| `ListViewContainer`, skeletons, FAB | Out of scope |
| Role-based `AppRoleGate` | Single-role owner app |

---

## Usage

```tsx
import { styles } from '@/styles';
import { Text } from '@/components/common/Text';

<View style={[styles.flex, styles.ph5, styles.rowSpaceBetween, styles.g3]}>
  <Text variant="h4" color="textStrong">Title</Text>
</View>
```

```tsx
import { useBorder } from '@/styles/border';

const border = useBorder();
<View style={[border.b1, border.b1R12]} />
```

---

## Migration Order (completed)

1. Handoff token audit → `tokens.ts`
2. Plus Jakarta Sans fonts
3. `src/styles/` utilities
4. `components/common/`
5. Screen + card style sweep
6. Expo Router navigation scaffold
