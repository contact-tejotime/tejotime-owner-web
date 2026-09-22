#!/usr/bin/env node
/**
 * Regenerates every app-icon and splash asset from ONE square master image.
 *
 *   cd app && node scripts/make-app-icons.mjs path/to/master-1024.png
 *   cd app && node scripts/make-app-icons.mjs assets/images/icon.png   # re-run from the current icon
 *
 * Writes into assets/images/:
 *   icon.png                     iOS (and the Expo fallback). Opaque RGB: App Store Connect
 *                                rejects an app icon that carries an alpha channel, even one
 *                                that is fully opaque.
 *   android-icon-background.png  Adaptive-icon back layer: the master's own background gradient.
 *   android-icon-foreground.png  Adaptive-icon front layer: the artwork lifted off that
 *                                background and shrunk into the 66dp safe circle.
 *   android-icon-monochrome.png  Android 13+ themed icon: the artwork's inked parts as one-colour
 *                                line art. Android reads only its alpha.
 *   favicon.png                  48 × 48, for the web build.
 *   splash-mark.png              The lifted artwork alone, tightly framed. The native splash
 *                                (app.json) draws it, and the animated splash starts from it.
 *   splash-wordmark.png          "TejoTime" + tagline, cut out of logo-full.png without its mark.
 *   splash-geometry.json         Where each piece sits, so TAnimatedSplash can assemble the
 *                                lockup without hand-copied numbers.
 *
 * Why the Android layers are not just the master: an adaptive icon is masked by the launcher
 * (circle, squircle, teardrop...) and only the centre 66 of its 108dp is guaranteed visible. The
 * master's artwork reaches ~75% of the canvas, so every circular launcher clipped the calendar's
 * corner and the clock's rim. The artwork is therefore lifted off its background and re-centred at
 * a size whose farthest point lands just inside that circle. The back layer carries the
 * background, so the visible result is the master, only fitted.
 *
 * Lifting it off: the master is a navy/blue illustration on a near-white gradient with a soft
 * navy-tinted drop shadow. "Background" is found by flooding in from the edges through light
 * pixels. The white calendar page and clock face are walled in by navy outlines, so the flood
 * never reaches them. Flooded pixels are then un-blended against the fitted gradient as navy at
 * partial alpha, which keeps the shadow and the anti-aliased edges instead of cutting them to a
 * hard, haloed matte.
 *
 * Dependencies: only `pngjs`, which Expo already installs. No image tool needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/make-app-icons.mjs <square master png>');
  process.exit(1);
}
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/images');

/** The master's outline navy. The drop shadow un-blends to exactly this tint (~10% alpha). */
const INK = [15, 34, 80];
/** Pixels at least this light may be background or shadow. Navy is ~33, the blue header ~90. */
const LIGHT_LUMA = 180;
/** 66dp safe circle of the 108dp canvas, less 3% so the rim never touches the mask edge. */
const SAFE_RADIUS_RATIO = (33 / 108) * 0.97;

const master = PNG.sync.read(fs.readFileSync(src));
const N = master.width;
if (master.height !== N) throw new Error(`master must be square, got ${master.width}×${master.height}`);

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const at = (x, y) => (y * N + x) * 4;

/* ---- 1. Background model: bilinear across the four corner colours ---- */
function cornerMean(x0, y0) {
  const B = 24;
  const sum = [0, 0, 0];
  for (let y = y0; y < y0 + B; y++)
    for (let x = x0; x < x0 + B; x++) for (let c = 0; c < 3; c++) sum[c] += master.data[at(x, y) + c];
  return sum.map((v) => v / (B * B));
}
const [TL, TR, BL, BR] = [cornerMean(0, 0), cornerMean(N - 24, 0), cornerMean(0, N - 24), cornerMean(N - 24, N - 24)];
const bgAt = (x, y) => {
  const u = x / (N - 1);
  const v = y / (N - 1);
  return [0, 1, 2].map((c) => (TL[c] * (1 - u) + TR[c] * u) * (1 - v) + (BL[c] * (1 - u) + BR[c] * u) * v);
};

/* ---- 2. Flood the exterior in from the border, through light pixels only ---- */
const exterior = new Uint8Array(N * N);
const light = (i) => luma(master.data[i * 4], master.data[i * 4 + 1], master.data[i * 4 + 2]) >= LIGHT_LUMA;
const queue = new Int32Array(N * N);
let head = 0;
let tail = 0;
for (let i = 0; i < N; i++)
  for (const p of [i, (N - 1) * N + i, i * N, i * N + N - 1])
    if (!exterior[p] && light(p)) {
      exterior[p] = 1;
      queue[tail++] = p;
    }
while (head < tail) {
  const p = queue[head++];
  const x = p % N;
  const y = (p / N) | 0;
  for (const q of [x > 0 ? p - 1 : -1, x < N - 1 ? p + 1 : -1, y > 0 ? p - N : -1, y < N - 1 ? p + N : -1])
    if (q >= 0 && !exterior[q] && light(q)) {
      exterior[q] = 1;
      queue[tail++] = q;
    }
}

/* ---- 3. Foreground (premultiplied float RGBA) and monochrome coverage, at master size ---- */
const fg = new Float32Array(N * N * 4);
const mono = new Float32Array(N * N * 4);
const inkL = luma(...INK);
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const [r, g, b] = [master.data[i * 4], master.data[i * 4 + 1], master.data[i * 4 + 2]];
    if (exterior[i]) {
      const bgL = luma(...bgAt(x, y));
      const a = clamp01((bgL - luma(r, g, b)) / (bgL - inkL));
      fg.set([INK[0] * a, INK[1] * a, INK[2] * a, a], i * 4);
      // mono stays 0: the shadow is not part of the glyph.
    } else {
      fg.set([r, g, b, 1], i * 4);
      // Inked = anything that is not white paper. Navy, blue and the orange hand all have a
      // low minimum channel; the page, the clock face and the checkmark do not.
      const m = clamp01((235 - Math.min(r, g, b)) / 115);
      mono.set([255 * m, 255 * m, 255 * m, m], i * 4);
    }
  }

/* ---- 4. Fit: centre on the artwork, shrink its farthest point into the safe circle ---- */
let [minX, minY, maxX, maxY] = [N, N, 0, 0];
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++)
    if (fg[(y * N + x) * 4 + 3] >= 0.5) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
const cx = (minX + maxX + 1) / 2;
const cy = (minY + maxY + 1) / 2;
let reach = 0;
for (let y = minY; y <= maxY; y++)
  for (let x = minX; x <= maxX; x++)
    if (fg[(y * N + x) * 4 + 3] >= 0.5) reach = Math.max(reach, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
const fit = (SAFE_RADIUS_RATIO * N) / reach;

/* ---- Resampling: supersampled bilinear on premultiplied RGBA, so edges carry no dark fringe ---- */
function sample(buf, W, sx, sy, out) {
  const x0 = Math.floor(sx - 0.5);
  const y0 = Math.floor(sy - 0.5);
  const fx = sx - 0.5 - x0;
  const fy = sy - 0.5 - y0;
  for (let c = 0; c < 4; c++) out[c] = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const x = x0 + dx;
    const y = y0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= W || w === 0) continue; // outside = transparent
    const i = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[c] += buf[i + c] * w;
  }
}
/** Output pixel (X, Y) of an S×S canvas shows master point centre + ((X, Y) − S/2) / k. */
function render(buf, S, k, centreX, centreY) {
  const out = new Float32Array(S * S * 4);
  const n = Math.max(4, Math.ceil(2 / k));
  const acc = [0, 0, 0, 0];
  const s = [0, 0, 0, 0];
  for (let Y = 0; Y < S; Y++)
    for (let X = 0; X < S; X++) {
      acc.fill(0);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          sample(buf, N, centreX + (X + (i + 0.5) / n - S / 2) / k, centreY + (Y + (j + 0.5) / n - S / 2) / k, s);
          for (let c = 0; c < 4; c++) acc[c] += s[c];
        }
      for (let c = 0; c < 4; c++) out[(Y * S + X) * 4 + c] = acc[c] / (n * n);
    }
  return out;
}

function writePng(file, S, premul, { opaque = false } = {}) {
  const png = new PNG({ width: S, height: S });
  for (let i = 0; i < S * S; i++) {
    const a = premul[i * 4 + 3];
    for (let c = 0; c < 3; c++) png.data[i * 4 + c] = Math.round(a > 0 ? Math.min(255, premul[i * 4 + c] / a) : 0);
    png.data[i * 4 + 3] = opaque ? 255 : Math.round(a * 255);
  }
  // colorType 2 = RGB with no alpha channel at all; 6 = RGBA.
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(png, { colorType: opaque ? 2 : 6 }));
  console.log(`wrote ${file} (${S}×${S}${opaque ? ', opaque RGB' : ', RGBA'})`);
}

/* ---- 5. Write ---- */
const masterPremul = new Float32Array(N * N * 4);
for (let i = 0; i < N * N; i++) {
  const a = master.data[i * 4 + 3] / 255;
  for (let c = 0; c < 3; c++) masterPremul[i * 4 + c] = master.data[i * 4 + c] * a + 255 * (1 - a); // flatten on white
  masterPremul[i * 4 + 3] = 1;
}
writePng('icon.png', N, masterPremul, { opaque: true });

const bg = new Float32Array(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) bg.set([...bgAt(x, y), 1], (y * N + x) * 4);
writePng('android-icon-background.png', N, bg, { opaque: true });

writePng('android-icon-foreground.png', N, render(fg, N, fit, cx, cy));
writePng('android-icon-monochrome.png', N, render(mono, N, fit, cx, cy));
writePng('favicon.png', 48, render(masterPremul, 48, 48 / N, N / 2, N / 2), { opaque: true });

/* ---- 6. Splash pieces ---- */
// The mark alone, its farthest point at 98% of the half-canvas. Square, so Android 12's 192dp
// splash circle takes it whole at any imageWidth up to ~196 (see docs/mobile-splash-and-branding.md).
const markFit = (0.98 * (N / 2)) / reach;
writePng('splash-mark.png', N, render(fg, N, markFit, cx, cy));

// Split logo-full.png into its mark and its wordmark by connected shape, not by a vertical cut:
// the clock's rim and the "T" share columns. Every shape whose centre is left of MARK_SPLIT_X is
// the mark; the rest (letters, tagline, its two dashes) is the wordmark.
const MARK_SPLIT_X = 150;
const lockup = PNG.sync.read(fs.readFileSync(path.join(OUT, 'logo-full.png')));
const LW = lockup.width;
const LH = lockup.height;
const inked = (i) => lockup.data[i * 4 + 3] > 24;
const label = new Int32Array(LW * LH).fill(-1);
const isMark = new Uint8Array(LW * LH);
const markBox = [LW, LH, 0, 0];
const wordBox = [LW, LH, 0, 0];
const grow = (b, x, y) => {
  b[0] = Math.min(b[0], x);
  b[1] = Math.min(b[1], y);
  b[2] = Math.max(b[2], x);
  b[3] = Math.max(b[3], y);
};
for (let start = 0, id = 0; start < LW * LH; start++) {
  if (label[start] !== -1 || !inked(start)) continue;
  const members = [];
  const stack = [start];
  label[start] = id;
  let sumX = 0;
  while (stack.length) {
    const q = stack.pop();
    members.push(q);
    const x = q % LW;
    const y = (q / LW) | 0;
    sumX += x;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx;
        const Y = y + dy;
        const r = Y * LW + X;
        if (X >= 0 && Y >= 0 && X < LW && Y < LH && label[r] === -1 && inked(r)) {
          label[r] = id;
          stack.push(r);
        }
      }
  }
  const mark = sumX / members.length < MARK_SPLIT_X;
  for (const q of members) {
    if (mark) isMark[q] = 1;
    grow(mark ? markBox : wordBox, q % LW, (q / LW) | 0);
  }
  id++;
}
// Faint anti-aliasing (alpha ≤ 24) belongs to whichever piece it touches. Clear a 2px halo
// around the mark out of the wordmark crop, so no sliver of the clock rides along with the "T".
const nearMark = (x, y) => {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx;
      const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < LW && Y < LH && isMark[Y * LW + X]) return true;
    }
  return false;
};
const [wx0, wy0] = [Math.max(0, wordBox[0] - 1), Math.max(0, wordBox[1] - 1)];
const [wx1, wy1] = [Math.min(LW - 1, wordBox[2] + 1), Math.min(LH - 1, wordBox[3] + 1)];
const word = new PNG({ width: wx1 - wx0 + 1, height: wy1 - wy0 + 1 });
for (let y = wy0; y <= wy1; y++)
  for (let x = wx0; x <= wx1; x++) {
    const s = (y * LW + x) * 4;
    const d = ((y - wy0) * word.width + (x - wx0)) * 4;
    word.data.set(lockup.data.subarray(s, s + 4), d);
    if (nearMark(x, y)) word.data[d + 3] = 0;
  }
fs.writeFileSync(path.join(OUT, 'splash-wordmark.png'), PNG.sync.write(word));
console.log(`wrote splash-wordmark.png (${word.width}×${word.height})`);

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const geometry = {
  // The artwork's box inside splash-mark.png, as fractions of the canvas. It is centred on the canvas.
  markArt: { width: round4(((maxX - minX + 1) * markFit) / N), height: round4(((maxY - minY + 1) * markFit) / N) },
  // logo-full.png's layout in its own pixels: where the (old) mark sat, and where the wordmark crop sits.
  lockup: {
    width: LW,
    height: LH,
    mark: { x: markBox[0], y: markBox[1], width: markBox[2] - markBox[0] + 1, height: markBox[3] - markBox[1] + 1 },
    wordmark: { x: wx0, y: wy0, width: word.width, height: word.height },
  },
};
fs.writeFileSync(path.join(OUT, 'splash-geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
console.log('wrote splash-geometry.json', JSON.stringify(geometry));

console.log(
  `artwork centre (${cx.toFixed(0)}, ${cy.toFixed(0)}), reach ${reach.toFixed(0)}px → scaled ×${fit.toFixed(3)} ` +
    `into the ${(SAFE_RADIUS_RATIO * N).toFixed(0)}px safe radius`,
);
