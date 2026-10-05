#!/usr/bin/env node
/**
 * sync-store-family — mirror frontend/src/lib/store-family.ts into admin-panel/, owner-web/ and app/.
 *
 * WHY THIS EXISTS
 * ---------------
 * The customer page picks its wording (and its default gallery heading) from the store's category,
 * and the three setup screens must offer ready-made gallery headings and headline suggestions for
 * the SAME kind of store (docs/store-setup-review-2026-10-05.md). Each app is Docker-built from its
 * own folder, so a package at the repo root is in no build context: the matcher is deliberately
 * copied into every app, and this script keeps the copies honest. Same idea as
 * sync-image-crop.mjs and sync-theme-engine.mjs.
 *
 * The module is import-free, so the copy is byte-for-byte identical with no per-app patching. Its
 * doc comment already names the source of truth, so anyone who opens a copy is sent to the source.
 *
 * USAGE
 * -----
 *   node scripts/sync-store-family.mjs            # write the copies  (npm run sync:family)
 *   node scripts/sync-store-family.mjs --check    # verify only       (npm run check:family)
 *
 * --check exits 1 listing each stale copy, 0 when all are in sync.
 *
 * Zero dependencies. Node 18+ (node: builtins only).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src', 'lib', 'store-family.ts');
const DESTS = ['admin-panel', 'owner-web', 'app'].map((app) => join(ROOT, app, 'src', 'lib', 'store-family.ts'));

const CHECK = process.argv.includes('--check');

async function main() {
  if (!existsSync(SRC)) {
    console.error(`sync-store-family: source missing at ${SRC}`);
    process.exit(1);
  }
  const source = await readFile(SRC, 'utf8');
  const stale = [];
  for (const dest of DESTS) {
    const current = existsSync(dest) ? await readFile(dest, 'utf8') : null;
    if (current === source) continue;
    const rel = dest.slice(ROOT.length + 1);
    if (CHECK) {
      stale.push(`${current === null ? 'missing' : 'differs'}: ${rel}`);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, source);
    console.log(`  wrote ${rel}`);
  }
  if (CHECK) {
    if (stale.length) {
      console.error('store-family copies are out of date — run `npm run sync:family`:');
      for (const s of stale) console.error(`  ${s}`);
      process.exit(1);
    }
    console.log('store-family copies are in sync.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
