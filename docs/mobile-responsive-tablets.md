# Mobile responsive layout — phones, tablets, foldables

How `app/` (the Expo owner app) adapts to screen size, and the rules to follow when adding a
screen. Written 2026-09-08 alongside the change that added tablet support.

The short version: **phones are unchanged**, **tablets rotate and get wider columns and 2-up
grids**, and **every size decision reads the live window**, not a value sampled at launch.

---

## 1. Rotation policy

**Tablets rotate freely. Phones stay portrait.**

Neither platform can express that declaratively in a way that survives `expo prebuild`, so it is
enforced in two places that agree with each other:

| Layer | File | What it does |
|---|---|---|
| Native (iOS) | `app.json` → `ios.infoPlist` | `UISupportedInterfaceOrientations` = portrait for iPhone; `…~ipad` = all four. An iPhone never even flashes landscape. |
| Native (both) | `app.json` → `orientation: "default"` | Unlocks the native projects so the runtime lock is the only authority on Android. |
| Runtime | `app/src/lib/orientation.ts` | `applyOrientationPolicy()` — called once from the root layout. Unlocks on tablets, locks `PORTRAIT_UP` on phones. |

Why the runtime lock exists at all: `android:screenOrientation` is a manifest **enum** with no
`sw600dp` resource variant, so the only per-device alternatives are patching `MainActivity` (which
every prebuild regenerates) or locking in JS. On iOS the call is belt-and-braces — the plist has
already done the job.

> **Do not set `ios.requireFullScreen: true`.** expo-screen-orientation's docs recommend it so
> that `lockAsync` works on iPad, but we never lock an iPad — we only *unlock* it. Turning it on
> would disable Split View and Slide Over for no gain. `UIRequiresFullScreen` stays `false`.

**Changing `app.json` orientation keys requires a native rebuild**, not just a Metro reload:
`npx expo prebuild` (or edit `ios/*/Info.plist` and `android/app/src/main/AndroidManifest.xml`
directly — both folders are gitignored and regenerated).

---

## 2. The size vocabulary

`app/src/lib/responsive.ts` is the single source of truth. It is deliberately **pure** — no React,
no `react-native`, no DOM — so it can be unit-checked without a simulator (see §6).

### Two different questions, two different answers

Confusing these is the most common way to get tablet layout wrong.

| Question | Use | Keys on |
|---|---|---|
| "Is this a tablet?" | `isTabletSize(w, h)` | The **device screen's short side** ≥ 600dp. Unchanged by rotation or by Split View. |
| "How much room do I have?" | `sizeClassFor(width)` | The **live window width**. Changes constantly. |

An iPad in Slide Over is a *tablet* with a *compact window*. A 6.7" phone in landscape is a
*phone* with an *expanded window*. Layout follows the window; only the rotation policy follows
the device.

The 600dp threshold is Android's own `sw600dp` qualifier. Testing the short side rather than the
current width is what makes a 600×960dp 7" tablet register as a tablet in portrait — the previous
`width >= 768` rule did not, so iPad minis and every small Android tablet got no tablet treatment
at all.

### Size classes (Material 3 / Apple)

| Class | Window width | Typical |
|---|---|---|
| `compact` | < 600dp | Phones in portrait; iPad Slide Over |
| `medium` | 600–839dp | Small tablets in portrait; large phones in landscape; half-screen iPad |
| `expanded` | ≥ 840dp | Tablets in landscape; iPad in portrait |

---

## 3. Content width — why phones did not change

Content is capped and centered when **the window is wider than the cap** (`contentMaxWidthFor`),
not when "this is a tablet".

Every cap the app passes (440, 520, 560, 640, 720, 900) is wider than any phone in portrait, so on
a phone the cap never engages, `centerStyle` is `null`, and the rendered tree is identical to
before. The cap engages exactly where it should: on tablets, and on a phone turned landscape where
an uncapped form would stretch to 850dp of unreadable line length.

The tab shell (`app/src/app/(app)/(tabs)/_layout.tsx`) caps at **720dp**, widening to **900dp** at
the `expanded` breakpoint. Screens *inside* that shell must size their grids against that column,
not against the window — use the `useTabContent()` hook, which resolves the same cap.

---

## 4. Type and spacing scale

`app/src/styles/scale.ts` shadows `react-native-size-matters`' exports of the same names. Every
call site imports from `@/styles/scale`, so this is the one place the ramp is defined.

Two things it fixes that the library does not do:

1. **It clamps.** The library's ratio is `window.width / 350` with no ceiling, so on an iPad a
   `moderateScale(16)` padding became 35–60dp and a 12dp radius became a 28dp blob — the entire UI
   inflated 2.4–3.9× on tablets. The width basis is now clamped to **320–480dp**.
2. **It is orientation-stable.** The library samples the window once at import time, which was
   safe only while the app was portrait-locked. The basis is now the **device screen's short
   side**, which does not change when you rotate or resize, so a value computed inside a
   module-level `StyleSheet.create` stays correct all session.

**Tablets gain their extra room through layout, not through bigger text.** A tablet should show
*more*, not a scaled-up phone.

---

## 5. Writing a responsive screen

```tsx
import { useTabContent } from '@/hooks/useResponsive';

const CARD_MIN_WIDTH = 320; // narrowest the card is still readable at

const { columns, gridItemWidth } = useTabContent();
const n = columns(CARD_MIN_WIDTH, { gutter: 12, max: 2 });

<View style={n > 1 ? s.grid : styles.g2}>
  {items.map((it) => (
    <View key={it.id} style={n > 1 ? { width: gridItemWidth(n) } : undefined}>
      <Card {...it} />
    </View>
  ))}
</View>
```

### Rules that are easy to get wrong

- **Never put a plain `gap` on a percentage-width grid row.** `gap` is absolute pixels while the
  cells are percentages, so `50% + 50% + gap` overflows the row by exactly the gap and flex-wrap
  quietly pushes the second cell onto its own line — a two-column grid that renders as a
  one-column list, with no error anywhere. Use `justifyContent: 'space-between'` plus `rowGap`.
  `gridItemWidth()` already reserves 3% per gutter so `n` cells sum to strictly under 100%.
- **A `FlatList` cannot change `numColumns` in place.** Put the count in the key
  (`key={`cols-${n}`}`) or rotating a tablet throws *"Changing numColumns on the fly is not
  supported"*.
- **Bottom sheets need a `maxHeight`.** They are anchored to the bottom, so an uncapped sheet
  grows off the *top* of a short window (a tablet in split-screen) and its title becomes
  unreachable. Cap at a percentage and let the body `flexShrink`.
- **Include `left`/`right` safe-area edges.** They are 0 in portrait and non-zero in landscape.
  But do not put them on a `SafeAreaView` that also paints a full-bleed bar — it pads the
  background too, leaving a strip of page colour down each side. Apply them to the content column
  and let the bar handle its own (see the tabs layout and `BottomNav`).
- **Anything that hit-tests coordinates needs both axes once a grid exists.** `QueueBoard`'s
  drag-and-drop resolved a drop target from `moveY` alone, which was sufficient while every seat
  spanned the full width. In a 2-up grid two seats share a y-range, so it now checks `x` too.

---

## 6. Testing

`app/src/lib/__tests__/responsive-check.ts` — a framework-free self-check, in the same spirit as
the theme engine's `run.ts`. Runs under the `tsx` that `backend/` already depends on, so it adds
no dependency to `app/package.json` and needs no runner, simulator or Metro.

```bash
npm run test:responsive     # from the repo root
# or: cd backend && npx tsx ../app/src/lib/__tests__/responsive-check.ts
```

1262 assertions across an 11-device matrix: size classes in both orientations, the tablet
threshold, the "phone portrait must not change" guarantee for every cap in the app, column-count
monotonicity and fit, and the grid percentage invariant.

**Why not an E2E test:** per `CLAUDE.md` §12.3 the mobile app is out of scope for both E2E tiers
(no Detox/Maestro, and adding one is explicitly discouraged), and none of this is reachable over
HTTP or a socket — it is layout arithmetic. `@/lib/responsive` is kept free of React and
react-native imports precisely so it can be exercised as plain TypeScript. The rendering that
consumes it is covered by `tsc --noEmit`, `expo lint`, and the manual matrix below.

> Like `check:theme` / `check:axes`, this is **not wired into CI**. Run it after touching
> breakpoints, caps or grid math.

### Manual device matrix

Verify after any layout change. Rotate each tablet, and put at least one iPad into Split View.

| Device | Portrait | Landscape |
|---|---|---|
| iPhone SE (375×667) | ✓ | locked out |
| iPhone 15 Pro Max (430×932) | ✓ | locked out |
| iPad mini (744×1133) | 1-up, 720 column | 2-up, 900 column |
| iPad Pro 12.9" (1024×1366) | 2-up, 900 column | 2-up, 900 column |
| Android 7" tablet (600×960) | 1-up, 600 window | 2-up, 900 column |
| Android 10" tablet (800×1280) | 2-up, 720 column | 2-up, 900 column |

---

## 7. What adapts today

| Surface | Phone | Tablet |
|---|---|---|
| Tab content column | full width | 720dp centered, 900dp when expanded |
| Bottom nav | full width | row capped to 640dp and centered |
| Customers | 1-up list | 2-up grid |
| Appointments | 1-up list | 2-up grid |
| Stats — by staff | 1-up list | 2-up grid |
| Queue board seats | 1 column | 2 columns (drag-and-drop hit-tests x and y) |
| Sheets and modals | full width | capped and centered (440–640dp), height-capped |
| Login | full width | 440dp centered card |

**Not adapted, deliberately:** the calendar's day cells stay a fixed 40dp touch target centered in
their `1/7` column — a bigger circle would not make a date easier to hit. There is no
master–detail (list beside detail) layout anywhere; `DetailPanel` is still a full-screen overlay
capped to 640dp.
