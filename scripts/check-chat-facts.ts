/**
 * Guard: the marketing chatbot's fact sheet must match the landing page's copy.
 *
 * `backend/src/lib/chat-platform.ts` hand-mirrors the product FAQs, plans, features, steps and
 * industries from `frontend/src/i18n/en.json` → `landingData`. It has to be a copy, because each
 * app is Docker-built from its own folder and the backend cannot import from `frontend/`
 * (CLAUDE.md §1). The failure this catches is the expensive one: marketing edits a price or
 * retires a plan, nobody updates the backend, and the bot keeps quoting the old number at
 * prospects for weeks.
 *
 * Run from the repo root:  npm run check:chat-facts
 *
 * It imports the real module through `tsx` (the same trick `npm run test:theme` uses) and
 * compares field by field. An earlier version searched the file for each string instead, and
 * silently passed a mutated price because the word "Free" also appears elsewhere in the file —
 * hence the structural comparison below.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_FACTS } from '../backend/src/lib/chat-platform';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const landing = JSON.parse(readFileSync(join(ROOT, 'frontend/src/i18n/en.json'), 'utf8')).landingData;

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const problems: string[] = [];

function eq(where: string, expected: unknown, actual: unknown) {
  if (norm(expected) !== norm(actual)) {
    problems.push(`${where}\n        landing page : ${norm(expected).slice(0, 110)}\n        chatbot      : ${norm(actual).slice(0, 110)}`);
  }
}

function sameLength(where: string, expected: unknown[], actual: unknown[]) {
  if (expected.length !== actual.length) {
    problems.push(`${where}: landing page has ${expected.length}, chatbot has ${actual.length}`);
    return false;
  }
  return true;
}

// ---- FAQs ----
if (sameLength('faqs count', landing.faqs, PLATFORM_FACTS.faqs)) {
  landing.faqs.forEach((f: { q: string; a: string }, i: number) => {
    eq(`faqs[${i}].q`, f.q, PLATFORM_FACTS.faqs[i]!.q);
    eq(`faqs[${i}].a`, f.a, PLATFORM_FACTS.faqs[i]!.a);
  });
}

// ---- Plans (the pricing table: the costliest thing to get wrong) ----
if (sameLength('plans count', landing.plans, PLATFORM_FACTS.plans)) {
  landing.plans.forEach((p: { name: string; price: string; per: string; who: string; feats: string[] }, i: number) => {
    const m = PLATFORM_FACTS.plans[i]!;
    eq(`plans[${i}].name`, p.name, m.name);
    eq(`plans[${i}].price`, p.price, m.price);
    eq(`plans[${i}].per`, p.per, m.per);
    eq(`plans[${i}].who`, p.who, m.who);
    if (sameLength(`plans[${i}].feats count`, p.feats, m.feats)) {
      p.feats.forEach((f, j) => eq(`plans[${i}].feats[${j}]`, f, m.feats[j]));
    }
  });
}

// ---- Features / steps ----
if (sameLength('features count', landing.features, PLATFORM_FACTS.features)) {
  landing.features.forEach((f: { head: string; body: string }, i: number) => {
    eq(`features[${i}].head`, f.head, PLATFORM_FACTS.features[i]!.head);
    eq(`features[${i}].body`, f.body, PLATFORM_FACTS.features[i]!.body);
  });
}
if (sameLength('steps count', landing.steps, PLATFORM_FACTS.steps)) {
  landing.steps.forEach((s: { head: string; body: string }, i: number) => {
    eq(`steps[${i}].head`, s.head, PLATFORM_FACTS.steps[i]!.head);
    eq(`steps[${i}].body`, s.body, PLATFORM_FACTS.steps[i]!.body);
  });
}

// ---- Perks ----
if (sameLength('inquiryPerks count', landing.inquiryPerks, PLATFORM_FACTS.perks)) {
  landing.inquiryPerks.forEach((p: string, i: number) => eq(`inquiryPerks[${i}]`, p, PLATFORM_FACTS.perks[i]));
}

// ---- Industries (the bot says them in lower-case prose, so compare case-insensitively) ----
if (sameLength('industries count', landing.industries, PLATFORM_FACTS.industries)) {
  landing.industries.forEach((ind: { name: string }, i: number) => {
    const a = norm(ind.name).toLowerCase();
    const b = norm(PLATFORM_FACTS.industries[i]).toLowerCase();
    if (a !== b) problems.push(`industries[${i}]\n        landing page : ${a}\n        chatbot      : ${b}`);
  });
}

if (problems.length) {
  console.error(`\n✗ Marketing chatbot facts have drifted from the landing page (${problems.length} issue(s)):\n`);
  for (const p of problems) console.error(`    • ${p}\n`);
  console.error('  Source of truth : frontend/src/i18n/en.json → landingData');
  console.error('  Mirror to fix   : backend/src/lib/chat-platform.ts → PLATFORM_FACTS\n');
  process.exit(1);
}
console.log(`✓ chat-platform.ts matches the landing page (${PLATFORM_FACTS.faqs.length} FAQs, ${PLATFORM_FACTS.plans.length} plans, ${PLATFORM_FACTS.features.length} features, ${PLATFORM_FACTS.industries.length} industries)`);
