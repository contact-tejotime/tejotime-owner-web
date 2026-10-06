import { describe, it, expect } from 'vitest';
import { isSmsCountryAllowed, parseCountryCodes } from '../../src/lib/sms-country';

// TWILIO_ALLOWED_COUNTRY_CODES (docs/sms-opt-in-a2p.md): the A2P campaign covers US numbers only,
// so a text to any other country is refused unless that country is listed on purpose.
describe('parseCountryCodes', () => {
  it('defaults to US (+1) when unset or blank', () => {
    expect(parseCountryCodes(undefined)).toEqual(['1']);
    expect(parseCountryCodes('')).toEqual(['1']);
    expect(parseCountryCodes('   ')).toEqual(['1']);
  });

  it('reads a comma-separated list, forgiving spaces, a leading + and repeats', () => {
    expect(parseCountryCodes('1')).toEqual(['1']);
    expect(parseCountryCodes(' +1 , 91 ')).toEqual(['1', '91']);
    expect(parseCountryCodes('1,91,1,+91')).toEqual(['1', '91']);
    expect(parseCountryCodes('1,44,353')).toEqual(['1', '44', '353']);
  });

  it('rejects anything that is not a list of 1-3 digit calling codes', () => {
    for (const bad of ['US', '1;91', '1234', '1,,91', '+', '1,IN', '0x1']) {
      expect(parseCountryCodes(bad)).toBeNull();
    }
  });
});

describe('isSmsCountryAllowed', () => {
  it('allows a +1 number under the US-only default', () => {
    expect(isSmsCountryAllowed('+12395061324', ['1'])).toBe(true);
  });

  it('blocks every other country until it is listed', () => {
    expect(isSmsCountryAllowed('+919824470182', ['1'])).toBe(false);
    expect(isSmsCountryAllowed('+447700900123', ['1'])).toBe(false);
    expect(isSmsCountryAllowed('+919824470182', ['1', '91'])).toBe(true);
    expect(isSmsCountryAllowed('+447700900123', ['1', '91'])).toBe(false);
  });

  it('blocks a number whose country cannot be known (no leading +)', () => {
    expect(isSmsCountryAllowed('12395061324', ['1'])).toBe(false);
    expect(isSmsCountryAllowed('9824470182', ['1', '91'])).toBe(false);
    expect(isSmsCountryAllowed('', ['1'])).toBe(false);
    expect(isSmsCountryAllowed('+', ['1'])).toBe(false);
    expect(isSmsCountryAllowed('+1 (239) 506-1324', ['1'])).toBe(false);
  });

  it('allows nothing when the list is empty', () => {
    expect(isSmsCountryAllowed('+12395061324', [])).toBe(false);
  });
});
