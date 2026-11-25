import { describe, expect, it } from 'vitest';
import {
  AMENITIES,
  amenitiesFromGoogle,
  canonicalAmenity,
  MAX_AUTOFILL_AMENITIES,
  mergeAmenities,
  suggestAmenities,
} from '../../src/lib/amenities';

/**
 * Pure (no env, no DB). The canonical amenity vocabulary for "autofill from a business name":
 * Google flags (A), website phrasing (B) and category suggestions (C) all land on ONE set of names,
 * and anything that matches nothing is dropped rather than pasted onto a customer page.
 */

describe('amenitiesFromGoogle (source A)', () => {
  it('maps every Google flag that is TRUE to its canonical name, in a stable order', () => {
    expect(
      amenitiesFromGoogle({
        parkingOptions: { freeParkingLot: true, freeStreetParking: true, paidStreetParking: true, valetParking: true },
        accessibilityOptions: {
          wheelchairAccessibleEntrance: true,
          wheelchairAccessibleParking: true,
          wheelchairAccessibleRestroom: true,
        },
        restroom: true,
        goodForChildren: true,
        allowsDogs: true,
      }),
    ).toEqual([
      'Free parking',
      'Free street parking',
      'Paid parking',
      'Valet parking',
      'Wheelchair accessible entrance',
      'Wheelchair accessible parking',
      'Wheelchair accessible restroom',
      'Restroom',
      'Kid friendly',
      'Pet friendly',
    ]);
  });

  it('never turns payment flags into an amenity (payment methods are not amenities)', () => {
    const withPayments = { restroom: true, paymentOptions: { acceptsCreditCards: true, acceptsNfc: true } };
    expect(amenitiesFromGoogle(withPayments as never)).toEqual(['Restroom']);
  });

  it('counts a free garage as free parking and any paid lot/garage/street as paid parking — once each', () => {
    expect(amenitiesFromGoogle({ parkingOptions: { freeGarageParking: true } })).toEqual(['Free parking']);
    expect(amenitiesFromGoogle({ parkingOptions: { paidParkingLot: true, paidGarageParking: true } })).toEqual(['Paid parking']);
  });

  it('adds nothing for false or missing flags (never guesses)', () => {
    expect(amenitiesFromGoogle({})).toEqual([]);
    expect(
      amenitiesFromGoogle({
        restroom: false,
        goodForChildren: false,
        allowsDogs: false,
        parkingOptions: { freeParkingLot: false },
      }),
    ).toEqual([]);
  });
});

describe('canonicalAmenity (source B — the website’s own words)', () => {
  it.each([
    ['AC', 'Air conditioned'],
    ['Fully air-conditioned', 'Air conditioned'],
    ['A/C', 'Air conditioned'],
    ['Free WiFi', 'Free Wi-Fi'],
    ['wi-fi available', 'Free Wi-Fi'],
    ['Comfortable waiting area', 'Waiting area'],
    ['Free tea & coffee', 'Complimentary tea/coffee'],
    ['Complimentary beverages', 'Complimentary drinks'],
    ['Ladies only section', 'Separate ladies section'],
    ['Private cabins', 'Private rooms'],
    ['Private treatment rooms', 'Private treatment rooms'],
    ['Steam shower', 'Shower'],
    ['Lockers for your belongings', 'Lockers'],
    ['Changing area', 'Changing room'],
    ['Bridal suite', 'Bridal room'],
    ['Free pick-up and drop', 'Pickup & drop'],
    ['Wheelchair accessible', 'Wheelchair accessible entrance'],
    ['Accessible toilet', 'Wheelchair accessible restroom'],
    ['Free street parking nearby', 'Free street parking'],
    ['Free parking', 'Free parking'],
    ['Valet', 'Valet parking'],
    ['Kids play area', 'Kid friendly'],
    ['Pet-friendly', 'Pet friendly'],
    ['Lift', 'Lift/elevator'],
    ['Robes & slippers', 'Robes & slippers'],
    ['robes and slippers', 'Robes & slippers'],
  ])('%s → %s', (raw, expected) => {
    expect(canonicalAmenity(raw)).toBe(expected);
  });

  it.each([
    'Parking available',
    'Bowling alley',
    'Lash lift',
    'Easily accessible by metro',
    'Private parking',
    // Payment methods are not amenities.
    'Tap to pay',
    'Contactless payments',
    'Cards & UPI accepted',
    '',
    42,
    null,
  ])(
    'skips %s (no honest match)',
    (raw) => {
      expect(canonicalAmenity(raw)).toBeNull();
    },
  );
});

describe('mergeAmenities', () => {
  it('keeps Google first, then the website, drops unmatched text and duplicates', () => {
    expect(mergeAmenities(['Free parking', 'Restroom'], ['AC', 'free wifi', 'Bowling alley', 'Restroom', 'restroom'])).toEqual([
      'Free parking',
      'Restroom',
      'Air conditioned',
      'Free Wi-Fi',
    ]);
  });

  it(`caps confirmed amenities at ${MAX_AUTOFILL_AMENITIES}`, () => {
    const many = ['AC', 'Wi-Fi', 'Waiting area', 'Tea', 'Shower', 'Lockers', 'Changing room', 'Bridal suite', 'TV', 'Music'];
    const out = mergeAmenities(['Restroom'], many);
    expect(out).toHaveLength(MAX_AUTOFILL_AMENITIES);
    expect(out[0]).toBe('Restroom');
  });
});

describe('suggestAmenities (source C)', () => {
  it('drops anything already confirmed by Google or the website', () => {
    expect(
      suggestAmenities(['Air conditioned', 'Free Wi-Fi', 'Waiting area', 'TV'], ['Air conditioned', 'Restroom']),
    ).toEqual(['Free Wi-Fi', 'Waiting area', 'TV']);
  });

  it('every canonical name maps to itself', () => {
    for (const a of AMENITIES) expect(canonicalAmenity(a)).toBe(a);
  });
});
