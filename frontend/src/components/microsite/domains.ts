/**
 * Per-domain copy and section priority.
 *
 * The microsite is one page shared by salons, hospitals, restaurants and gyms, and until now
 * every one of them got salon wording — a clinic's page said "Our team · live availability"
 * above a section headed "What we offer". The queue mechanics are genuinely identical across
 * verticals, so the fix is not four pages: it is one page whose LABELS and SECTION ORDER come
 * from the store's category.
 *
 * Matching is by the `business_category` lookup values the admin panel already stores
 * ("Salon & Barber", "Hospital", …), lowercased and substring-matched so a new category like
 * "Dental Clinic" still lands on the clinic profile rather than falling back to generic.
 *
 * Anything not listed falls through to DEFAULT_DOMAIN, which is the current salon wording —
 * so a category nobody has profiled yet renders exactly as it does today.
 */

import { t, format } from "@/i18n";

/** Sections whose order varies by domain. Everything else keeps its fixed position. */
export type DomainSection = "live" | "services" | "about" | "gallery" | "reviews";

export interface DomainProfile {
  id: string;
  /** Order of the reorderable sections, first = highest on the page. */
  order: DomainSection[];
  /** "Our team · live availability" */
  liveHeading: string;
  /** Verb used on a staff member's CTA: `Join {name}'s line` */
  liveCta: (name: string) => string;
  /** "What we offer" */
  servicesHeading: string;
  servicesNote: string;
  /** Word for one bookable item — "service", "treatment", "dish". */
  serviceNoun: string;
  galleryHeading: string;
  /** Final CTA band. Its sub-line is not here: it is count- and open/closed-aware, so it is
   *  composed in MicrositeClient from `t.microsite.cta.sub*`. */
  ctaHeading: string;
  /** Shown as a prominent strip above everything — clinics only, for now. */
  urgentLabel?: string;
}

export const DEFAULT_DOMAIN: DomainProfile = {
  id: "generic",
  order: ["live", "about", "gallery", "services", "reviews"],
  liveHeading: t.domains.generic.liveHeading,
  liveCta: (name) => format(t.domains.generic.liveCta, { name }),
  servicesHeading: t.domains.generic.servicesHeading,
  servicesNote: t.domains.generic.servicesNote,
  serviceNoun: t.domains.generic.serviceNoun,
  galleryHeading: t.domains.generic.galleryHeading,
  ctaHeading: t.domains.generic.ctaHeading,
};

const PROFILES: { match: string[]; profile: DomainProfile }[] = [
  {
    match: ["salon", "barber", "beauty", "parlour", "parlor", "spa", "nail", "tattoo"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "beauty",
      order: ["live", "services", "gallery", "about", "reviews"],
      liveHeading: t.domains.beauty.liveHeading,
      liveCta: (name) => format(t.domains.beauty.liveCta, { name }),
      servicesHeading: t.domains.beauty.servicesHeading,
      servicesNote: t.domains.beauty.servicesNote,
      serviceNoun: t.domains.beauty.serviceNoun,
      galleryHeading: t.domains.beauty.galleryHeading,
      ctaHeading: t.domains.beauty.ctaHeading,
    },
  },
  {
    match: ["hospital", "clinic", "dental", "dentist", "medical", "health", "diagnostic", "pet"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "clinic",
      // Wait time and doctors come first; marketing copy drops below them.
      order: ["live", "services", "about", "reviews", "gallery"],
      liveHeading: t.domains.clinic.liveHeading,
      liveCta: (name) => format(t.domains.clinic.liveCta, { name }),
      servicesHeading: t.domains.clinic.servicesHeading,
      servicesNote: t.domains.clinic.servicesNote,
      serviceNoun: t.domains.clinic.serviceNoun,
      galleryHeading: t.domains.clinic.galleryHeading,
      ctaHeading: t.domains.clinic.ctaHeading,
      urgentLabel: t.domains.clinic.urgentLabel,
    },
  },
  {
    match: ["restaurant", "cafe", "coffee", "bakery", "food", "dhaba", "bar", "kitchen"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "food",
      // Photos sell a restaurant; menu follows, staff barely matters to a diner.
      order: ["gallery", "services", "live", "about", "reviews"],
      liveHeading: t.domains.food.liveHeading,
      liveCta: (name) => format(t.domains.food.liveCta, { name }),
      servicesHeading: t.domains.food.servicesHeading,
      servicesNote: t.domains.food.servicesNote,
      serviceNoun: t.domains.food.serviceNoun,
      galleryHeading: t.domains.food.galleryHeading,
      ctaHeading: t.domains.food.ctaHeading,
    },
  },
  {
    match: ["gym", "fitness", "yoga", "crossfit", "sport", "studio", "academy"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "fitness",
      order: ["services", "live", "gallery", "about", "reviews"],
      liveHeading: t.domains.fitness.liveHeading,
      liveCta: (name) => format(t.domains.fitness.liveCta, { name }),
      servicesHeading: t.domains.fitness.servicesHeading,
      servicesNote: t.domains.fitness.servicesNote,
      serviceNoun: t.domains.fitness.serviceNoun,
      galleryHeading: t.domains.fitness.galleryHeading,
      ctaHeading: t.domains.fitness.ctaHeading,
    },
  },
];

/** Never throws; an unknown or empty category returns the current salon-flavoured wording. */
export function domainFor(category: string | null | undefined): DomainProfile {
  const c = (category ?? "").toLowerCase();
  if (!c) return DEFAULT_DOMAIN;
  for (const { match, profile } of PROFILES) {
    if (match.some((m) => c.includes(m))) return profile;
  }
  return DEFAULT_DOMAIN;
}
