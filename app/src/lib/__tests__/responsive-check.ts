/**
 * Responsive / tablet layout self-check.
 *
 * Deliberately framework-free, in the same spirit as the theme engine's
 * `__tests__/run.ts`: it runs under the `tsx` that backend/ already depends on,
 * so it adds no dependency to app/package.json and needs no test runner, no
 * simulator and no Metro bundler.
 *
 *   npm run test:responsive
 *   # or: cd backend && npx tsx ../app/src/lib/__tests__/responsive-check.ts
 *
 * Why this and not an E2E test: per CLAUDE.md §12.3 the mobile app is out of
 * scope for the repo's E2E tiers (there is no Detox/Maestro and adding one is
 * explicitly discouraged), and none of this is reachable over HTTP or a socket
 * anyway — it is layout arithmetic. `@/lib/responsive` is kept free of React and
 * react-native imports precisely so it can be exercised here as plain
 * TypeScript. The rendering that consumes it is verified by `tsc --noEmit` and
 * `expo lint`, plus manual passes on the device matrix in
 * docs/mobile-responsive-tablets.md.
 *
 * Covers:
 *   (a) DEVICES  — the real device matrix lands in the intended size class, and
 *                  tablet detection survives rotation.
 *   (b) CAPS     — phone portrait is byte-identical to the pre-tablet layout
 *                  (no cap engages), while wide windows do get capped.
 *   (c) COLUMNS  — column counts are sane, monotonic in width, never zero.
 *   (d) GRID     — n cells + gutters always sum to strictly under 100%, the
 *                  invariant that stops a wrap grid collapsing to one column.
 *
 * Failures throw. A non-zero exit code is the signal; the log is for humans.
 */

import {
  BREAKPOINTS,
  columnsFor,
  contentMaxWidthFor,
  gridItemWidth,
  isTabletSize,
  sizeClassFor,
  TABLET_MIN_SHORT_SIDE,
  tabContentCapFor,
  type SizeClass,
} from '../responsive';

let checks = 0;

function ok(condition: boolean, what: string): void {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${what}`);
}

function eq<T>(actual: T, expected: T, what: string): void {
  checks += 1;
  if (actual !== expected) {
    throw new Error(`FAIL: ${what}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// (a) DEVICES — the matrix we actually claim to support.
// `portrait` is [width, height] held upright, in dp.
// ---------------------------------------------------------------------------

type Device = {
  name: string;
  portrait: [number, number];
  tablet: boolean;
  /** Size class expected in portrait, then in landscape. */
  classes: [SizeClass, SizeClass];
};

const DEVICES: Device[] = [
  // Phones — small to large. None of these is a tablet in either orientation.
  { name: 'iPhone SE (2nd/3rd)', portrait: [375, 667], tablet: false, classes: ['compact', 'medium'] },
  { name: 'iPhone 15', portrait: [393, 852], tablet: false, classes: ['compact', 'expanded'] },
  { name: 'iPhone 15 Pro Max', portrait: [430, 932], tablet: false, classes: ['compact', 'expanded'] },
  { name: 'Pixel 7', portrait: [412, 915], tablet: false, classes: ['compact', 'expanded'] },
  { name: 'Small Android (320dp)', portrait: [320, 640], tablet: false, classes: ['compact', 'medium'] },

  // Tablets — the sw600dp floor upward. Tablet in BOTH orientations.
  { name: 'Android 7" tablet', portrait: [600, 960], tablet: true, classes: ['medium', 'expanded'] },
  { name: 'Android 10" tablet', portrait: [800, 1280], tablet: true, classes: ['medium', 'expanded'] },
  { name: 'iPad mini', portrait: [744, 1133], tablet: true, classes: ['medium', 'expanded'] },
  { name: 'iPad 10.2"', portrait: [810, 1080], tablet: true, classes: ['medium', 'expanded'] },
  { name: 'iPad Air / Pro 11"', portrait: [834, 1194], tablet: true, classes: ['medium', 'expanded'] },
  { name: 'iPad Pro 12.9"', portrait: [1024, 1366], tablet: true, classes: ['expanded', 'expanded'] },
];

for (const d of DEVICES) {
  const [w, h] = d.portrait;

  eq(isTabletSize(w, h), d.tablet, `${d.name}: tablet detection in portrait`);
  // The whole point of measuring the short side: rotating must not change the
  // answer. A width-based check would call a 430x932 phone a tablet in landscape.
  eq(isTabletSize(h, w), d.tablet, `${d.name}: tablet detection in landscape`);

  eq(sizeClassFor(w), d.classes[0], `${d.name}: size class in portrait`);
  eq(sizeClassFor(h), d.classes[1], `${d.name}: size class in landscape`);
}

// The boundary itself, so nobody moves it by accident.
eq(isTabletSize(TABLET_MIN_SHORT_SIDE, 1000), true, 'sw600dp is a tablet');
eq(isTabletSize(TABLET_MIN_SHORT_SIDE - 1, 1000), false, 'sw599dp is not a tablet');
eq(sizeClassFor(BREAKPOINTS.medium - 1), 'compact', 'just below the medium breakpoint');
eq(sizeClassFor(BREAKPOINTS.medium), 'medium', 'at the medium breakpoint');
eq(sizeClassFor(BREAKPOINTS.expanded - 1), 'medium', 'just below the expanded breakpoint');
eq(sizeClassFor(BREAKPOINTS.expanded), 'expanded', 'at the expanded breakpoint');

// iPad multitasking: the *window* shrinks while the device stays a tablet. Layout
// must follow the window, so a Slide Over panel is treated as compact.
eq(sizeClassFor(320), 'compact', 'iPad Slide Over panel is a compact window');
eq(isTabletSize(1024, 1366), true, 'the device is still a tablet during Slide Over');

// ---------------------------------------------------------------------------
// (b) CAPS — the no-regression guarantee for phones.
// ---------------------------------------------------------------------------

/** Every cap passed to useResponsive anywhere in the app. */
const CAPS = [440, 520, 560, 640, 720, 900];
const PHONE_PORTRAIT_WIDTHS = DEVICES.filter((d) => !d.tablet).map((d) => d.portrait[0]);

for (const cap of CAPS) {
  for (const width of PHONE_PORTRAIT_WIDTHS) {
    eq(
      contentMaxWidthFor(width, cap),
      undefined,
      `cap ${cap} must not engage on a ${width}dp phone in portrait (would change shipped layout)`,
    );
  }
}

// ...but it must engage once there is genuinely too much width.
eq(contentMaxWidthFor(1194, 900), 900, 'iPad landscape caps to the expanded column');
eq(contentMaxWidthFor(852, 720), 720, 'a phone in landscape is capped, not stretched');
// Exactly at the cap is not "wider than", so no centering wrapper is introduced.
eq(contentMaxWidthFor(720, 720), undefined, 'a window exactly at the cap stays full-bleed');

// The cases the previous rule got wrong. It gated capping on `width >= 768`
// (a "tablet" test), so anything between a phone and 768dp was left uncapped:
// an iPad mini in portrait got no tablet treatment whatsoever, and a 7" tablet
// stretched the 440dp login card across its full 600dp width. Capping on
// `width > cap` instead is what fixes both, and these pin it down.
eq(contentMaxWidthFor(600, 440), 440, '7" tablet portrait caps the login card');
eq(contentMaxWidthFor(744, 560), 560, 'iPad mini portrait caps a sheet (744dp is under the old 768 gate)');
eq(contentMaxWidthFor(744, 720), 720, 'iPad mini portrait caps the tab content column');
eq(contentMaxWidthFor(667, 640), 640, 'a small phone in landscape caps rather than stretching');

eq(tabContentCapFor(393), 720, 'phone portrait uses the base tab cap');
eq(tabContentCapFor(834), 720, 'iPad portrait (medium) uses the base tab cap');
eq(tabContentCapFor(1194), 900, 'iPad landscape (expanded) widens the tab cap');

// ---------------------------------------------------------------------------
// (c) COLUMNS
// ---------------------------------------------------------------------------

// Never zero, never NaN, whatever nonsense arrives.
for (const w of [0, -1, NaN, 10]) {
  eq(columnsFor(w, { minItemWidth: 320 }), 1, `columnsFor(${w}) falls back to a single column`);
}
eq(columnsFor(700, { minItemWidth: 0 }), 1, 'a zero-width item does not divide by zero');

// The real call sites, at the capped widths they actually receive.
eq(columnsFor(393, { minItemWidth: 320, gutter: 12, max: 2 }), 1, 'phone portrait: customers 1-up');
eq(columnsFor(720, { minItemWidth: 320, gutter: 12, max: 2 }), 2, 'tablet: customers 2-up');
eq(columnsFor(900, { minItemWidth: 320, gutter: 14, max: 2 }), 2, 'iPad landscape: queue seats 2-up');
eq(columnsFor(900, { minItemWidth: 340, gutter: 8, max: 2 }), 2, 'iPad landscape: appointments 2-up');
// `max` is a real ceiling — 900dp would otherwise fit a cramped third column.
eq(columnsFor(900, { minItemWidth: 300, gutter: 8, max: 2 }), 2, 'max caps the column count');
eq(columnsFor(900, { minItemWidth: 300, gutter: 8 }), 2, 'without max, 300dp items still fit only 2 in 900dp');

// Monotonic: more room never means fewer columns.
let previous = 0;
for (let w = 100; w <= 2000; w += 10) {
  const n = columnsFor(w, { minItemWidth: 320, gutter: 12 });
  ok(n >= previous, `column count must not decrease as width grows (at ${w}dp)`);
  previous = n;
}

// n columns must genuinely fit: n items + (n-1) gutters cannot exceed the width.
for (let w = 200; w <= 2000; w += 7) {
  for (const min of [200, 300, 320, 340, 480]) {
    const gutter = 12;
    const n = columnsFor(w, { minItemWidth: min, gutter });
    if (n > 1) {
      ok(
        n * min + (n - 1) * gutter <= w,
        `columnsFor(${w}, min ${min}) returned ${n}, which does not fit`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (d) GRID — the invariant that keeps a wrap grid from collapsing.
// ---------------------------------------------------------------------------

eq(gridItemWidth(1), '100%', 'a single column takes the whole row');
eq(gridItemWidth(0), '100%', 'a nonsense column count degrades to one column');
eq(gridItemWidth(2.9), gridItemWidth(2), 'a fractional column count floors');

for (let n = 2; n <= 6; n += 1) {
  const pct = Number(gridItemWidth(n).replace('%', ''));
  ok(Number.isFinite(pct) && pct > 0, `gridItemWidth(${n}) is a positive percentage`);
  // Strictly under 100 with room to spare: this is what guarantees that n cells
  // fit on one row no matter how the platform rounds sub-pixels. If this ever
  // fails, grids silently render as single-column lists with no error anywhere.
  ok(pct * n < 100, `gridItemWidth(${n}) x ${n} must be strictly under 100% (got ${pct * n})`);
  // Gutters cost 3% per gap, so the wasted share grows with n. Only assert the
  // efficiency bound over the counts the app can actually produce — every grid
  // here passes `max: 2`, and 3 is headroom. Beyond that the fixed-percentage
  // gutter would be the wrong model anyway.
  if (n <= 3) {
    ok(pct * n > 92, `gridItemWidth(${n}) x ${n} should not waste more than 8% of the row`);
  }
}

console.log(`responsive self-check: ${checks} assertions passed across ${DEVICES.length} devices`);
