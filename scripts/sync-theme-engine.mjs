#!/usr/bin/env node
/**
 * sync-theme-engine — mirror the theme engine from frontend/ into admin-panel/.
 *
 * WHY THIS EXISTS
 * ---------------
 * frontend/ and admin-panel/ are each Docker-built with `COPY . .` from their OWN folder
 * (Railway "Root Directory" = the app folder). A package at the repo root is therefore NOT in
 * either build context: anything an app imports MUST live under that app's folder. So the one
 * engine is deliberately duplicated — authored in frontend/src/theme/engine, copied verbatim
 * into admin-panel/src/theme/engine — and this script is the guard that keeps the duplication
 * honest.
 *
 * This file lives in scripts/ at the repo root, which is fine: it is a DEV tool run by a human
 * or by CI, never imported by an app, never present in a build context.
 *
 * USAGE
 * -----
 *   node scripts/sync-theme-engine.mjs            # write the mirror  (npm run sync:theme)
 *   node scripts/sync-theme-engine.mjs --check    # verify only       (npm run check:theme)
 *
 * --check exits 1 with a file-by-file summary when the mirror is stale, 0 when it is in sync.
 * Wire it into CI ahead of the admin-panel build.
 *
 * RULES
 * -----
 *   - frontend/src/theme/engine is the ONLY source of truth. Never hand-edit the mirror.
 *   - __tests__/ is not copied: the self-check runs against the source via `npm run test:theme`.
 *   - The mirror's index.ts is prefixed with a generated-file banner so anyone who opens it
 *     lands on the instruction to edit the source instead.
 *   - The banner is deterministic (no timestamps, no hashes) so --check can compare bytes.
 *
 * Zero dependencies. Node 18+ (node: builtins only).
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_REL = join('frontend', 'src', 'theme', 'engine');

/**
 * Every app that needs the engine gets its own copy, for the same reason admin-panel does:
 * each is built from its own folder (frontend/, admin-panel/, owner-web/ by Docker `COPY . .`,
 * app/ by EAS from the Expo project root), so nothing outside that folder exists at build time.
 */
const TARGET_RELS = [
  join('admin-panel', 'src', 'theme', 'engine'),
  join('app', 'src', 'theme', 'engine'),
  join('owner-web', 'src', 'theme', 'engine'),
];

const SOURCE_DIR = join(REPO_ROOT, SOURCE_REL);

/** Directory names never copied into the mirror. */
const EXCLUDED_DIRS = new Set(['__tests__', 'node_modules']);
/** File names never copied into the mirror. */
const EXCLUDED_FILES = new Set(['.DS_Store']);

/** Only this file gets the banner; every other file is copied byte-for-byte. */
const BANNER_TARGET = 'index.ts';

const BANNER = [
  '/* -------------------------------------------------------------------------------------------',
  ' * GENERATED FILE — DO NOT EDIT.',
  ' *',
  ` * Mirror of ${SOURCE_REL.split(sep).join('/')}/, copied by scripts/sync-theme-engine.mjs.`,
  ' * Edit the source in frontend/, then run `npm run sync:theme` from the repo root.',
  ' * CI runs `npm run check:theme` and fails if this copy has drifted.',
  ' *',
  ' * The engine is duplicated rather than shared because each app is Docker-built with',
  ' * `COPY . .` from its own folder — a repo-root package would not exist in the build context.',
  ' * ----------------------------------------------------------------------------------------- */',
  '',
  '',
].join('\n');

/* ------------------------------------------------------------------ helpers */

/** Recursively collect file paths under `dir`, relative to it, POSIX-separated, sorted. */
async function collect(dir, prefix = '') {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...(await collect(join(dir, entry.name), `${prefix}${entry.name}/`)));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue;
      files.push(`${prefix}${entry.name}`);
    }
  }
  return files.sort();
}

/** The exact bytes file `rel` should have in the mirror. */
async function renderedContent(rel) {
  const raw = await readFile(join(SOURCE_DIR, rel), 'utf8');
  return rel === BANNER_TARGET ? BANNER + raw : raw;
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** First 1-based line number at which two strings differ, plus how many lines differ. */
function diffStat(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const max = Math.max(a.length, b.length);
  let first = 0;
  let count = 0;
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) {
      if (first === 0) first = i + 1;
      count += 1;
    }
  }
  return { firstLine: first, changedLines: count, expectedLines: a.length, actualLines: b.length };
}

/** Compare source → mirror. Returns { added, changed, removed, unchanged }. */
async function plan(TARGET_DIR, TARGET_REL) {
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`Source engine not found at ${SOURCE_REL}. Nothing to sync.`);
  }

  const sourceFiles = await collect(SOURCE_DIR);
  if (sourceFiles.length === 0) {
    throw new Error(`Source engine at ${SOURCE_REL} is empty. Refusing to wipe the mirror.`);
  }

  const targetFiles = new Set(await collect(TARGET_DIR));

  const added = [];
  const changed = [];
  const unchanged = [];

  for (const rel of sourceFiles) {
    const expected = await renderedContent(rel);
    const actual = await readIfPresent(join(TARGET_DIR, rel));
    if (actual === null) {
      added.push({ rel, expected });
    } else if (actual !== expected) {
      changed.push({ rel, expected, stat: diffStat(expected, actual) });
    } else {
      unchanged.push({ rel });
    }
    targetFiles.delete(rel);
  }

  // Anything left in the mirror has no counterpart in the source — it must go.
  const removed = [...targetFiles].sort().map((rel) => ({ rel }));

  return { added, changed, removed, unchanged };
}

/** Delete directories that became empty after removals, stopping at TARGET_DIR. */
async function pruneEmptyDirs(startDir, targetDir) {
  let dir = startDir;
  while (dir.startsWith(targetDir) && dir !== targetDir) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    await rmdir(dir);
    dir = dirname(dir);
  }
}

function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

/* --------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    console.error(`sync-theme-engine: unknown argument(s): ${unknown.join(', ')}`);
    console.error('Usage: node scripts/sync-theme-engine.mjs [--check]');
    process.exit(2);
  }

  let anyStale = false;
  for (const TARGET_REL of TARGET_RELS) {
    const TARGET_DIR = join(REPO_ROOT, TARGET_REL);
    const { added, changed, removed, unchanged } = await plan(TARGET_DIR, TARGET_REL);
    const stale = added.length + changed.length + removed.length;
    if (stale > 0) anyStale = true;

  if (checkOnly) {
    if (stale === 0) {
      console.log(
        `theme engine mirror is in sync — ${unchanged.length} file(s), ` +
          `${SOURCE_REL.split(sep).join('/')} → ${TARGET_REL.split(sep).join('/')}`,
      );
      continue;
    }

    console.error('theme engine mirror is STALE.');
    console.error(`  source: ${SOURCE_REL.split(sep).join('/')}`);
    console.error(`  mirror: ${TARGET_REL.split(sep).join('/')}`);
    console.error('');
    for (const { rel: r } of added) {
      console.error(`  + missing from mirror   ${r}`);
    }
    for (const { rel: r, stat } of changed) {
      console.error(
        `  ~ differs               ${r}  (first diff at line ${stat.firstLine}; ` +
          `${stat.changedLines} line(s) differ; source ${stat.expectedLines} vs mirror ${stat.actualLines})`,
      );
    }
    for (const { rel: r } of removed) {
      console.error(`  - not in source         ${r}`);
    }
    console.error('');
    console.error(
      `  ${stale} file(s) out of date, ${unchanged.length} in sync.\n` +
        '  Never hand-edit the mirror. Fix the source under frontend/, then run:\n' +
        '      npm run sync:theme',
    );
    continue;
  }

  for (const { rel: r, expected } of added) {
    const dest = join(TARGET_DIR, r);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, expected, 'utf8');
    console.log(`  + ${rel(dest)}`);
  }
  for (const { rel: r, expected } of changed) {
    const dest = join(TARGET_DIR, r);
    await writeFile(dest, expected, 'utf8');
    console.log(`  ~ ${rel(dest)}`);
  }
  for (const { rel: r } of removed) {
    const dest = join(TARGET_DIR, r);
    await rm(dest, { force: true });
    await pruneEmptyDirs(dirname(dest), TARGET_DIR);
    console.log(`  - ${rel(dest)}`);
  }

  if (stale === 0) {
      console.log(
        `${TARGET_REL.split(sep).join('/')} already in sync — ${unchanged.length} file(s).`,
      );
  } else {
    console.log(
        `${TARGET_REL.split(sep).join('/')} updated — ${added.length} added, ` +
          `${changed.length} changed, ${removed.length} removed, ${unchanged.length} unchanged.`,
    );
  }
  }

  if (checkOnly) process.exit(anyStale ? 1 : 0);
}

main().catch((err) => {
  console.error(`sync-theme-engine: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
