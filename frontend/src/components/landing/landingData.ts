import { t } from "@/i18n";

import type { ApptStatus, Tone } from "./ds";
import type { IconName } from "./Icon";

/**
 * Presentation data for the landing page: which icon, which colour token,
 * where a block sits on the demo calendar.
 * Every user-facing word comes from `t.landing*` — this file only decides how
 * it looks.
 */

/* ------------------------------------------------------------- sections -- */

export const nav = [
  { label: t.landing.nav.features, href: "/#product" },
  { label: t.landing.nav.industries, href: "/#industries" },
  { label: t.landing.nav.pricing, href: "/#pricing" },
  { label: t.landing.nav.resources, href: "/resources" },
];

/** Trust strip under the hero calendar — product truths, not fabricated review scores. */
export const proofSignals = t.landingData.proofSignals;
export const proofStats = t.landingData.proofStats;

const FEATURE_ICONS: IconName[] = ["building", "calendar", "hourglass", "bell", "users", "trendingUp"];

export const features = t.landingData.features.map((f, i) => ({
  icon: FEATURE_ICONS[i],
  head: f.head,
  body: f.body,
}));

/** Stock placeholders for the industries grid — replace with pilot photography when ready. */
export const INDUSTRY_SLUGS = [
  "hair-salons",
  "barbershops",
  "nail-studios",
  "spas",
  "med-spas",
  "massage-therapy",
  "physical-therapy",
  "tattoo-studios",
  "pet-grooming",
] as const;

export type IndustrySlug = (typeof INDUSTRY_SLUGS)[number];

const INDUSTRY_IMAGES: Record<IndustrySlug, string> = {
  "hair-salons": "/landing/industries/hair-salons.jpg",
  barbershops: "/landing/industries/barbershops.jpg",
  "nail-studios": "/landing/industries/nail-studios.jpg",
  spas: "/landing/industries/spas.jpg",
  "med-spas": "/landing/industries/med-spas.jpg",
  "massage-therapy": "/landing/industries/massage-therapy.jpg",
  "physical-therapy": "/landing/industries/physical-therapy.jpg",
  "tattoo-studios": "/landing/industries/tattoo-studios.jpg",
  "pet-grooming": "/landing/industries/pet-grooming.jpg",
};

export const industries = INDUSTRY_SLUGS.map((slug, n) => {
  const i = t.landingData.industries[n];
  return {
    slug,
    href: `/industries/${slug}`,
    name: i.name,
    detail: i.detail,
    n: String(n + 1).padStart(2, "0"),
    image: INDUSTRY_IMAGES[slug],
  };
});

export const industryPages = INDUSTRY_SLUGS.map((slug) => {
  const page = t.landingData.industryPages[slug];
  return {
    slug,
    href: `/industries/${slug}`,
    image: INDUSTRY_IMAGES[slug],
    ...page,
  };
});

export function getIndustryPage(slug: string) {
  return industryPages.find((p) => p.slug === slug) ?? null;
}

/** Stock placeholders for the “Inside the shops” gallery — replace with pilot photography when ready. */
const GALLERY_IMAGES = [
  "/landing/gallery/floor-at-open.jpg",
  "/landing/gallery/walk-in.jpg",
  "/landing/gallery/rebooking.jpg",
] as const;

export const gallery = t.landingData.gallery.map((g, i) => ({
  title: g.title,
  caption: g.caption,
  n: String(i + 1).padStart(2, "0"),
  image: GALLERY_IMAGES[i],
}));

export const steps = t.landingData.steps.map((s, i) => ({
  n: String(i + 1),
  head: s.head,
  body: s.body,
}));

export const plans = t.landingData.plans.map((p, i) => ({
  ...p,
  featured: i === 1,
  variant: (i === 1 ? "primary" : "outline") as "primary" | "outline",
  border: i === 1 ? "2px solid var(--primary)" : "1px solid var(--border-subtle)",
  shadow: i === 1 ? "var(--shadow-lg)" : "var(--shadow-xs)",
}));

/* ------------------------------------------------------- booking widget -- */

const SELECTED_SLOT = "11:00 AM";

export const slots = t.landingData.slots.map((time) => {
  const on = time === SELECTED_SLOT;
  return {
    time,
    on,
    border: on ? "var(--primary)" : "var(--border-default)",
    bg: on ? "var(--primary-soft)" : "var(--surface-card)",
    fg: on ? "var(--primary)" : "var(--text-body)",
  };
});

/** The third row is an open slot, dimmed to read as available rather than booked. */
export const scheduleRows: {
  name: string;
  service: string;
  time: string;
  status: ApptStatus;
  style: React.CSSProperties;
}[] = [
  { ...t.landingData.scheduleRows[0], status: "confirmed", style: {} },
  {
    ...t.landingData.scheduleRows[1],
    status: "confirmed",
    style: { borderColor: "var(--success)", boxShadow: "0 0 0 1px var(--success)" },
  },
  { ...t.landingData.scheduleRows[2], status: "upcoming", style: { opacity: 0.55 } },
];

/* ------------------------------------------------------ walk-in board -- */

const WAIT_META: { status: ApptStatus; position: number; waitMinutes?: number }[] = [
  { status: "in-service", position: 24 },
  { status: "waiting", position: 25, waitMinutes: 12 },
  { status: "waiting", position: 26, waitMinutes: 24 },
  { status: "confirmed", position: 27, waitMinutes: 36 },
];

export const waitBoard = t.landingData.waitBoard.map((w, i) => ({ ...w, ...WAIT_META[i] }));

export const WAIT_MINUTES = { base: 35, afterAdd: 48 } as const;

/* ------------------------------------------------------- day calendar -- */

/**
 * Blocks are placed from real start/end times so the demo grid stays honest.
 * `ROW` is px per half hour; 52px gives the shortest real appointment (35 min)
 * room for its three lines of type rather than clipping them.
 */
const ROW = 52;
const DAY_START = 8 * 60; // 8:00 am — the first labelled hour.

/** [column, startMin, endMin, tone] — minutes from midnight. */
const APPTS: [number, number, number, Tone][] = [
  [0, 480, 525, "primary"],
  [0, 600, 635, "success"],
  [0, 660, 720, "warning"],
  [1, 480, 540, "warning"],
  [1, 600, 635, "success"],
  [1, 735, 810, "primary"],
  [2, 510, 585, "success"],
  [2, 585, 675, "primary"],
  [2, 675, 750, "error"],
  [3, 540, 615, "error"],
  [3, 735, 810, "primary"],
];

/** [startMin, endMin, tone] for the phone mock beside the desktop calendar. */
const PHONE_APPTS: [number, number, Tone][] = [
  [510, 570, "success"],
  [570, 690, "primary"],
  [720, 780, "warning"],
];

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}

function place(start: number, end: number, row: number) {
  return {
    top: `${((start - DAY_START) * row) / 30}px`,
    height: `${Math.max(28, ((end - start) * row) / 30 - 4)}px`,
  };
}

export const calHours = t.landingData.hours.map((label, i) => ({
  label,
  top: `${i * ROW * 2}px`,
}));

export const calCols = t.landingData.providers.map((name, ci) => ({
  name,
  appts: APPTS.map((a, idx) => ({ a, idx }))
    .filter(({ a }) => a[0] === ci)
    .map(({ a, idx }, k) => ({
      ...place(a[1], a[2], ROW),
      time: `${fmt(a[1])} – ${fmt(a[2])}`,
      client: t.landingData.appointments[idx].client,
      service: t.landingData.appointments[idx].service,
      bg: `var(--${a[3]}-soft)`,
      fg: `var(--${a[3]}-soft-fg)`,
      delay: `${(0.25 + ci * 0.09 + k * 0.05).toFixed(2)}s`,
    })),
}));

/** Pixels per hour on the phone mock; `place()` takes px per half-hour. */
const PHONE_HOUR = 64;
const PHONE_HALF = PHONE_HOUR / 2;

export const phoneDay = {
  name: t.landingData.phoneProvider,
  hours: t.landingData.hours.slice(0, 6).map((label, i) => ({ label, top: `${i * PHONE_HOUR}px` })),
  appts: PHONE_APPTS.map((a, i) => ({
    ...place(a[0], a[1], PHONE_HALF),
    time: `${fmt(a[0])} – ${fmt(a[1])}`,
    client: t.landingData.phoneAppointments[i].client,
    service: t.landingData.phoneAppointments[i].service,
    bg: `var(--${a[2]}-soft)`,
    fg: `var(--${a[2]}-soft-fg)`,
  })),
};

/** Bottom tab bar of the phone mock; the middle "add" tab reads as active. */
export const phoneNav = (["calendar", "dollar", "plus", "users", "grid"] as IconName[]).map((icon, i) => ({
  icon,
  bg: i === 2 ? "var(--primary)" : "transparent",
  fg: i === 2 ? "var(--text-on-brand)" : "var(--text-muted)",
}));

/* ----------------------------------------------------------------- misc -- */

export const footerCols = t.landingData.footerCols;
export const faqs = t.landingData.faqs;
export const inquiryPerks = t.landingData.inquiryPerks;
export const client = t.landingData.client;
export const bookingBullets = t.landingData.bookingBullets;
export const walkBullets = t.landingData.walkBullets;
export const clientBullets = t.landingData.clientBullets;
