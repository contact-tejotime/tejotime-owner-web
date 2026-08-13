#!/usr/bin/env node
/**
 * check-theme-axes — every editable theme axis must appear in every place that enumerates them.
 *
 * WHY THIS EXISTS
 * ---------------
 * Adding the `button` axis shipped a silent bug: three separate files hand-list the axes, and
 * one of them is each Appearance panel's `key()` dirty-check. `dirty` gates the Save button, so
 * an axis missing from that list is not merely "not repainted" — it is UNSAVEABLE on its own,
 * with no error anywhere. The engine was correct the whole time; the list was not.
 *
 * Hand-written lists are the right call in most of these files (the backend cannot import from
 * frontend/, and the panels want a cheap string compare), so the fix is not to remove them but
 * to make forgetting one loud.
 *
 * USAGE
 *   node scripts/check-theme-axes.mjs        # npm run check:axes
 *
 * Exits 1 listing every file that is missing an axis.
 *
 * Zero dependencies. Node 18+.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Source of truth: the optional axes declared on ThemeConfig. `preset`/`mode`/`brand` are required. */
async function axesFromEngine() {
  const src = await readFile(join(ROOT, 'frontend/src/theme/engine/types.ts'), 'utf8');
  const body = src.slice(src.indexOf('export interface ThemeConfig {'));
  const decl = body.slice(0, body.indexOf('\n}'));
  return [...decl.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
}

/**
 * Files that enumerate the axes by hand.
 *
 * `scope` narrows the search to the function that actually does the enumerating. Without it the
 * check is worthless for the dirty-check files: the word `button` appears elsewhere in the same
 * component (wiring the picker), so a whole-file search passes while `key()` is still missing it
 * — which is precisely the bug that prompted this script.
 */
const TARGETS = [
  {
    file: 'admin-panel/src/components/appearance/AppearancePanel.tsx',
    purpose: 'admin dirty-check (gates Save)',
    scope: /function key\(c: ThemeConfig\): string \{[\s\S]*?\n\}/,
  },
  {
    file: 'owner-web/src/components/appearance/AppearancePanel.tsx',
    purpose: 'owner-web dirty-check (gates Save)',
    scope: /function key\(c: ThemeConfig\): string \{[\s\S]*?\n\}/,
  },
  {
    file: 'app/src/app/(app)/settings/appearance.tsx',
    purpose: 'mobile dirty-check (gates Save)',
    scope: /function themeKey\(c: ThemeConfig\): string \{[\s\S]*?\n\}/,
  },
  {
    file: 'backend/src/modules/admin/admin.routes.ts',
    purpose: 'admin zod schema (strips unknown keys)',
    scope: /theme: z[\s\S]*?\.partial\(\)/,
  },
  {
    file: 'backend/src/modules/business/business.routes.ts',
    purpose: 'business zod schema (strips unknown keys)',
    scope: /theme: z[\s\S]*?\.partial\(\)/,
  },
  {
    file: 'backend/src/domain/business-theme.ts',
    purpose: 'backend ThemeConfigInput',
    scope: /export interface ThemeConfigInput \{[\s\S]*?\n\}/,
  },
  {
    file: 'owner-web/src/lib/server-api.ts',
    purpose: 'owner-web API mirror',
    scope: /export interface ThemeConfig \{[\s\S]*?\n\}/,
  },
];

const axes = await axesFromEngine();
if (axes.length < 5) {
  console.error('check-theme-axes: could not parse ThemeConfig — refusing to pass vacuously');
  process.exit(1);
}

const problems = [];
for (const { file, purpose, scope } of TARGETS) {
  const src = await readFile(join(ROOT, file), 'utf8');
  const region = scope.exec(src)?.[0];
  if (!region) {
    // A renamed function must fail loudly rather than quietly stop checking anything.
    problems.push(`${file}\n    ${purpose}\n    could not locate the enumerating block — update this script's scope regex`);
    continue;
  }
  // Comments do not count. A note that merely mentions an axis by name would otherwise satisfy
  // the check while the actual list is still missing it — which is how the first version of this
  // script passed on the mobile file.
  const code = region.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const missing = axes.filter((a) => !new RegExp(`\\b${a}\\b`).test(code));
  if (missing.length) problems.push(`${file}\n    ${purpose}\n    missing: ${missing.join(', ')}`);
}

if (problems.length) {
  console.error(`check-theme-axes: ${problems.length} file(s) are missing a theme axis\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  console.error('Add the axis to each file above, then re-run.');
  process.exit(1);
}
console.log(`check-theme-axes: ok — ${axes.length} axes present in ${TARGETS.length} files`);
console.log(`  axes: ${axes.join(', ')}`);
