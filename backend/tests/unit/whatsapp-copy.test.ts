import { describe, expect, it } from 'vitest';
import {
  STORE_FALLBACK,
  param,
  waParamsBookingConfirmed,
  waParamsReminder,
  waParamsReview,
} from '../../src/lib/whatsapp-copy';

/**
 * The approved templates' {{1}}..{{n}} (docs/whatsapp-india.md). The order is the contract with
 * WhatsApp Manager: a swapped pair still sends, and reads "Hi Sharp Cuts, your appointment at
 * Alexander". Meta also rejects the whole message for an empty variable or one with a newline.
 */
describe('WhatsApp template variables', () => {
  it('booking_confirmed: first name, store, date, time, link', () => {
    expect(
      waParamsBookingConfirmed('Alexander Hamilton', '5th Avenue Barber & Shave Shop', 'Sep 26', '1:11 PM', 'https://www.tejotime.com/12393160008'),
    ).toEqual(['Alexander', '5th Avenue Barber & Shave Shop', 'Sep 26', '1:11 PM', 'https://www.tejotime.com/12393160008']);
  });

  it('appointment_reminder: first name, store, address', () => {
    expect(waParamsReminder('Alexander', 'Sharp Cuts', '1011 5th Ave N, Naples, FL 34102', 'https://www.tejotime.com/1')).toEqual([
      'Alexander',
      'Sharp Cuts',
      '1011 5th Ave N, Naples, FL 34102',
    ]);
  });

  it('review_request: store, first name, link', () => {
    expect(waParamsReview('Alexander', 'Sharp Cuts', 'https://www.tejotime.com/919399385943/r')).toEqual([
      'Sharp Cuts',
      'Alexander',
      'https://www.tejotime.com/919399385943/r',
    ]);
  });

  it('a store with no address gets its booking page, since "Address:" is fixed template text', () => {
    expect(waParamsReminder('Asha', 'Sharp Cuts', null, 'https://www.tejotime.com/919399385943')[2]).toBe(
      'https://www.tejotime.com/919399385943',
    );
    expect(waParamsReminder('Asha', 'Sharp Cuts', '   ', 'https://www.tejotime.com/919399385943')[2]).toBe(
      'https://www.tejotime.com/919399385943',
    );
  });

  it('a store with a blank name is "the store", and a blank customer name is "there"', () => {
    expect(waParamsBookingConfirmed('  ', ' ', 'Oct 6', '6:00 AM', 'https://x.test')).toEqual([
      'there',
      STORE_FALLBACK,
      'Oct 6',
      '6:00 AM',
      'https://x.test',
    ]);
    expect(waParamsReview('', '', 'https://x.test/r').slice(0, 2)).toEqual([STORE_FALLBACK, 'there']);
  });

  it('no variable is ever empty or carries a newline, a tab or a run of spaces', () => {
    const all = [
      ...waParamsBookingConfirmed('', '', '', '', ''),
      ...waParamsReminder('', 'Shop\n\tNo. 4', 'Line one\nLine two     Pune', ''),
      ...waParamsReview('', '', ''),
    ];
    for (const v of all) {
      expect(v.length).toBeGreaterThan(0);
      expect(v).not.toMatch(/[\n\t]| {2,}/);
    }
    expect(waParamsReminder('A', 'B', 'Line one\nLine two     Pune', '')[2]).toBe('Line one Line two Pune');
  });

  it('param keeps a real value untouched and falls back only when blank', () => {
    expect(param('Sharp Cuts', 'x')).toBe('Sharp Cuts');
    expect(param(undefined, 'x')).toBe('x');
    expect(param(' \n ', 'x')).toBe('x');
  });
});
