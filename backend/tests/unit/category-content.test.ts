import { describe, expect, it } from 'vitest';
import { canonicalAmenity } from '../../src/lib/amenities';
import {
  amenitySuggestionsFor,
  CONTENT_PRESETS,
  categoryForPreset,
  containsForbiddenClaim,
  FORBIDDEN_PHRASES,
  galleryHeadingFor,
  presetFor,
  staffRoleFor,
  starterServices,
  templateCopy,
  type ContentPreset,
} from '../../src/lib/category-content';

/**
 * Pure config (no env, no DB). Proves each preset yields its own copy and compliant,
 * price-free starter services, and that the templates never advertise a feature this product
 * does not have (deposits, pet notes, packages, a per-turn SMS).
 */

const ctx = (over: Partial<{ name: string; city: string; area: string; isUsStore: boolean }> = {}) => ({
  name: 'Test Business',
  city: 'Surat',
  area: 'Mota Varachha',
  isUsStore: false,
  ...over,
});

describe('category-content presets', () => {
  it('each preset has its own headline, hero subtitle, gallery heading and starter services', () => {
    const headlines = new Set<string>();
    const galleries = new Set<string>();
    for (const preset of CONTENT_PRESETS) {
      const copy = templateCopy(preset, ctx());
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.heroSubtitle.length).toBeGreaterThan(0);
      headlines.add(copy.headline);
      galleries.add(galleryHeadingFor(preset));

      const services = starterServices(preset);
      expect(services.length).toBeGreaterThan(0);
      for (const s of services) {
        expect(s.durationMinutes).toBeGreaterThanOrEqual(1); // duration is never guessed-away
        expect(s).not.toHaveProperty('priceRupees'); // starter services carry no price (always "unset")
      }
    }
    // Distinct copy per preset, not one template reused.
    expect(headlines.size).toBe(CONTENT_PRESETS.length);
    expect(galleries.size).toBeGreaterThan(5);
  });

  it('templates never claim a feature the product does not have (both markets)', () => {
    for (const preset of CONTENT_PRESETS) {
      for (const isUsStore of [true, false]) {
        const copy = templateCopy(preset, ctx({ isUsStore }));
        const blob = [copy.headline, copy.heroSubtitle, copy.aboutHeading, copy.description, ...copy.faqs.flatMap((f) => [f.q, f.a])].join('\n');
        expect(containsForbiddenClaim(blob), `${preset} (${isUsStore ? 'US' : 'IN'}): "${blob}"`).toBe(false);
      }
    }
  });

  it('switches wording on the market (queue/line, parlour/salon, physiotherapist)', () => {
    const inWords = templateCopy('barbershop', ctx({ isUsStore: false }));
    const usWords = templateCopy('barbershop', ctx({ isUsStore: true }));
    expect(inWords.description).toMatch(/queue/);
    expect(usWords.description).toMatch(/line/);
    expect(usWords.description).not.toMatch(/\bqueue\b/);

    expect(staffRoleFor('physio', false)).toBe('Physiotherapist');
    expect(staffRoleFor('physio', true)).toBe('Physical therapist');
    expect(templateCopy('beauty_parlour', ctx({ isUsStore: false })).description).toMatch(/parlour/);
  });

  it('each preset suggests six distinct amenities, all from the canonical list', () => {
    for (const preset of CONTENT_PRESETS) {
      const suggestions = amenitySuggestionsFor(preset);
      expect(suggestions, preset).toHaveLength(6);
      expect(new Set(suggestions).size, preset).toBe(6);
      for (const s of suggestions) expect(canonicalAmenity(s), `${preset}: ${s}`).toBe(s);
    }
    expect(amenitySuggestionsFor('spa')).toContain('Robes & slippers');
    expect(amenitySuggestionsFor('beauty_parlour')).toContain('Separate ladies section');
    expect(amenitySuggestionsFor('pet')).toContain('Pickup & drop');
  });

  it('drops a dangling separator when the area is unknown', () => {
    const copy = templateCopy('hair_salon', ctx({ area: '', city: '' }));
    expect(copy.heroSubtitle).not.toMatch(/[·•]\s*$/);
    expect(copy.description).toContain('Test Business is a hair salon.');
  });

  it('FORBIDDEN_PHRASES actually catches the banned claims', () => {
    expect(FORBIDDEN_PHRASES.length).toBeGreaterThan(0);
    expect(containsForbiddenClaim('We take a deposit to hold your slot')).toBe(true);
    expect(containsForbiddenClaim('Add notes about your pet when you book')).toBe(true);
    expect(containsForbiddenClaim('Buy one of our packages')).toBe(true);
    expect(containsForbiddenClaim("We'll text you when it's your turn")).toBe(true);
    expect(containsForbiddenClaim('Join the queue and see your live wait')).toBe(false);
  });
});

describe('presetFor + category mapping', () => {
  it.each<[string, string[], string | null, ContentPreset | null]>([
    ['barber by type', ['barber_shop'], null, 'barbershop'],
    ['barber by name', [], null, null], // bare types empty, name below handles it
    ['nail salon', ['nail_salon'], null, 'nail'],
    ['spa', ['spa'], null, 'spa'],
    ['massage', ['massage'], null, 'massage'],
    ['physio', ['physiotherapist'], null, 'physio'],
    ['tattoo', ['body_art_service'], null, 'tattoo'],
    ['skin clinic → medspa', ['skin_care_clinic'], null, 'medspa'],
    ['hair salon', ['hair_salon'], null, 'hair_salon'],
    ['beauty salon in India → parlour', ['beauty_salon'], 'IN', 'beauty_parlour'],
    ['beauty salon in US → hair salon', ['beauty_salon'], 'US', 'hair_salon'],
    ['hospital → none', ['hospital'], null, null],
  ])('%s', (_label, types, region, expected) => {
    expect(presetFor(types, 'Some Place', region)).toBe(expected);
  });

  it('matches by name keyword when the type is generic', () => {
    expect(presetFor(['point_of_interest'], "Tony's Barber Lounge")).toBe('barbershop');
    expect(presetFor(['point_of_interest'], 'Happy Paws Pet Grooming')).toBe('pet');
    expect(presetFor(['point_of_interest'], 'Ink Masters Tattoo')).toBe('tattoo');
    expect(presetFor([], 'Glow Med Spa')).toBe('medspa');
    // "carpet" must not read as "pet".
    expect(presetFor([], 'Carpet World')).toBeNull();
  });

  it('maps presets to the three real categories (pet has none)', () => {
    expect(categoryForPreset('hair_salon')).toBe('Salon & Barber');
    expect(categoryForPreset('barbershop')).toBe('Salon & Barber');
    expect(categoryForPreset('beauty_parlour')).toBe('Salon & Barber');
    expect(categoryForPreset('medspa')).toBe('Hospital');
    expect(categoryForPreset('physio')).toBe('Hospital');
    expect(categoryForPreset('pet')).toBe('');
  });
});
