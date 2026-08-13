#!/usr/bin/env node
/**
 * sync-image-crop — mirror the crop-before-upload module from admin-panel/ into owner-web/.
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reason as sync-theme-engine.mjs: admin-panel/ and owner-web/ are each Docker-built with
 * `COPY . .` from their OWN folder (Railway "Root Directory" = the app folder). A package at the
 * repo root is not in either build context, so anything an app imports MUST live under that
 * app's folder. The one cropper is therefore deliberately duplicated — authored in
 * admin-panel/src/components/image-crop, copied verbatim into owner-web — and this script is the
 * guard that keeps the duplication honest.
 *
 * The module only depends on `@/i18n` (both apps expose `t` and `format` with the same
 * `imageCrop` group) and on CSS custom properties both apps define, so the copy is byte-for-byte
 * identical with no per-app patching.
 *
 * USAGE
 * -----
 *   node scripts/sync-image-crop.mjs            # write the mirror  (npm run sync:crop)
 *   node scripts/sync-image-crop.mjs --check    # verify only       (npm run check:crop)
 *
 * --check exits 1 with a file-by-file summary when the mirror is stale, 0 when it is in sync.
 *
 * RULES
 * -----
 *   - admin-panel/src/components/image-crop is the ONLY source of truth. Never hand-edit the mirror.
 *   - The mirror's index.ts already carries a "generated mirror" banner in its doc comment, so
 *     anyone who opens it lands on the instruction to edit the source instead.
 *   - Deterministic output (no timestamps, no hashes) so --check can compare bytes.
 *
 * Zero dependencies. Node 18+ (node: builtins only).
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'admin-panel', 'src', 'components', 'image-crop');
const DEST = join(ROOT, 'owner-web', 'src', 'components', 'image-crop');

const CHECK = process.argv.includes('--check');

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...(await listFiles(join(dir, entry.name))).map((f) => join(entry.name, f)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`sync-image-crop: source missing at ${SRC}`);
    process.exit(1);
  }

  const files = await listFiles(SRC);
  const stale = [];

  for (const rel of files) {
    const source = await readFile(join(SRC, rel), 'utf8');
    const target = join(DEST, rel);
    const current = existsSync(target) ? await readFile(target, 'utf8') : null;

    if (current === source) continue;

    if (CHECK) {
      stale.push(`${current === null ? 'missing' : 'differs'}: ${rel}`);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    console.log(`  wrote ${rel}`);
  }

  // Anything in the mirror that is no longer in the source is a leftover.
  if (existsSync(DEST)) {
    for (const rel of await listFiles(DEST)) {
      if (files.includes(rel)) continue;
      if (CHECK) stale.push(`orphan: ${rel}`);
      else {
        await rm(join(DEST, rel));
        console.log(`  removed ${rel}`);
      }
    }
  }

  if (CHECK) {
    if (stale.length) {
      console.error('sync-image-crop: mirror is stale\n  ' + stale.join('\n  '));
      console.error('\nRun: node scripts/sync-image-crop.mjs');
      process.exit(1);
    }
    console.log(`sync-image-crop: in sync (${files.length} files)`);
    return;
  }
  console.log(`sync-image-crop: mirrored ${files.length} files into owner-web`);
}

await main();
