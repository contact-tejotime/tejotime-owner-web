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
  statValue?: string;
  statLabel?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  aboutImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  payments?: string[];
  faqs?: { q: string; a: string }[];
  reviews?: { stars: number; text: string; authorName: string }[];
  theme?: ThemeConfig;
};

export type GalleryImageInput = { url: string; alt?: string | null };
