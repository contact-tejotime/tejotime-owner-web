import type { ThemeConfig } from '@/theme/engine';

/** Fields the owner app may PATCH onto `/business`. */
export type BusinessProfilePatch = {
  name?: string;
  category?: string;
  tagline?: string;
  heroSubtitle?: string;
  area?: string;
  city?: string;
  address?: string;
  establishedYear?: number | null;
  aboutHeading?: string;
  description?: string;
  /**
   * The photo gallery's heading on the page; '' clears it back to the store type's default.
   * Owner-only on the API (a staff login sending it is refused), like aboutHeading.
   */
  galleryHeading?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  aboutImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  yelpUrl?: string;
  /** Post-visit review SMS link; '' clears it (no review text is sent). */
  googleReviewUrl?: string;
  payments?: string[];
  faqs?: { q: string; a: string }[];
  reviews?: { stars: number; text: string; authorName: string }[];
  theme?: ThemeConfig;
};

export type GalleryImageInput = { url: string; alt?: string | null };
