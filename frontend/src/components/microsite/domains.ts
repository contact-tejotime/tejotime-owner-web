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

/** Sections whose order varies by domain. Everything else keeps its fixed position. */
export type DomainSection = "live" | "services" | "about" | "gallery" | "reviews";

export interface DomainProfile {
  id: string;
  /** Order of the reorderable sections, first = highest on the page. */
  order: DomainSection[];
  /** "Our team · live availability" */
  liveHeading: string;
  liveNote: string;
  /** Verb used on a staff member's CTA: `Join {name}'s line` */
  liveCta: (name: string) => string;
  /** "What we offer" */
  servicesHeading: string;
  servicesNote: string;
  /** Word for one bookable item — "service", "treatment", "dish". */
  serviceNoun: string;
  galleryHeading: string;
  /** Final CTA band. */
  ctaHeading: string;
  ctaSub: string;
  /** Shown as a prominent strip above everything — clinics only, for now. */
  urgentLabel?: string;
}

export const DEFAULT_DOMAIN: DomainProfile = {
  id: "generic",
  order: ["live", "about", "gallery", "services", "reviews"],
  liveHeading: "Our team · live availability",
  liveNote: "Updated live · pick a member when you join",
  liveCta: (name) => `Join ${name}'s line`,
  servicesHeading: "What we offer",
  servicesNote: "Book or walk in — pick a service when you join",
  serviceNoun: "service",
  galleryHeading: "Gallery",
  ctaHeading: "Skip the wait — join the live queue",
  ctaSub: "It's the queue · Walk in soon · we'll text you when you're near",
};

const PROFILES: { match: string[]; profile: DomainProfile }[] = [
  {
    match: ["salon", "barber", "beauty", "parlour", "parlor", "spa", "nail", "tattoo"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "beauty",
      order: ["live", "services", "gallery", "about", "reviews"],
      liveHeading: "Our stylists · live availability",
      liveNote: "Updated live · pick your stylist when you join",
      liveCta: (name) => `Book with ${name}`,
      servicesHeading: "Treatments & pricing",
      servicesNote: "Walk in or reserve a slot — prices are per treatment",
      serviceNoun: "treatment",
      galleryHeading: "Our work",
      ctaHeading: "Skip the wait — join the live queue",
      ctaSub: "See the real wait before you leave home",
    },
  },
  {
    match: ["hospital", "clinic", "dental", "dentist", "medical", "health", "diagnostic", "pet"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "clinic",
      // Wait time and doctors come first; marketing copy drops below them.
      order: ["live", "services", "about", "reviews", "gallery"],
      liveHeading: "Doctors on duty · live OPD wait",
      liveNote: "Updated live · queue position is held from the moment you join",
      liveCta: (name) => `Join Dr. ${name}'s queue`,
      servicesHeading: "Departments & consultations",
      servicesNote: "Consultation charges shown per department",
      serviceNoun: "consultation",
      galleryHeading: "Our facility",
      ctaHeading: "Join the OPD queue from home",
      ctaSub: "Track your position live — no waiting-room crowding",
      urgentLabel: "For emergencies call the hospital directly",
    },
  },
  {
    match: ["restaurant", "cafe", "coffee", "bakery", "food", "dhaba", "bar", "kitchen"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "food",
      // Photos sell a restaurant; menu follows, staff barely matters to a diner.
      order: ["gallery", "services", "live", "about", "reviews"],
      liveHeading: "Live table availability",
      liveNote: "Updated live · we'll text you when your table is ready",
      liveCta: (name) => `Join ${name}'s section`,
      servicesHeading: "Menu highlights",
      servicesNote: "A taste of the menu — full card available in-store",
      serviceNoun: "dish",
      galleryHeading: "From our kitchen",
      ctaHeading: "Join the waitlist — skip the queue outside",
      ctaSub: "See the real wait before you drive over",
    },
  },
  {
    match: ["gym", "fitness", "yoga", "crossfit", "sport", "studio", "academy"],
    profile: {
      ...DEFAULT_DOMAIN,
      id: "fitness",
      order: ["services", "live", "gallery", "about", "reviews"],
      liveHeading: "Trainers on the floor",
      liveNote: "Updated live · grab a trainer when they're free",
      liveCta: (name) => `Train with ${name}`,
      servicesHeading: "Classes & sessions",
      servicesNote: "Drop in or reserve a slot",
      serviceNoun: "session",
      galleryHeading: "Inside the gym",
      ctaHeading: "Reserve your slot",
      ctaSub: "See how busy the floor is before you head over",
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
