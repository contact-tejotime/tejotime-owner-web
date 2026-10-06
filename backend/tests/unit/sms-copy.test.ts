import { describe, it, expect } from 'vitest';
import {
  REMINDER_LEAD_MINUTES,
  SMS_TEMPLATES,
  isReminderDue,
  smsBodyBookingConfirmed,
  smsBodyReminder,
  smsBodyReview,
  smsDateTime,
} from '../../src/lib/sms-copy';

// These strings ARE the approved Twilio A2P campaign samples (docs/sms-opt-in-a2p.md). If one of
// these expectations has to change, the registered campaign samples must change with it.
describe('sms-copy', () => {
  const shop = '5th Avenue Barber & Shave Shop';

  it('exposes exactly the three template ids', () => {
    expect(SMS_TEMPLATES).toEqual({
      bookingConfirmed: 'booking_confirmed',
      appointmentReminder: 'appointment_reminder',
      reviewRequest: 'review_request',
    });
  });

  // Approved 2026-10-06. The approved samples put a "." straight after each link; the bodies
  // deliberately do not (see the next test), which is the only difference.
  it('renders the three approved bodies word for word', () => {
    expect(
      smsBodyBookingConfirmed('Alexander', shop, 'Sep 26', '1:11 PM', 'https://www.tejotime.com/12393160008'),
    ).toBe(
      'TejoTime: Hi Alexander, your appointment at 5th Avenue Barber & Shave Shop is confirmed for Sep 26 at 1:11 PM. Manage your booking: https://www.tejotime.com/12393160008 Reply STOP to opt out.',
    );
    expect(smsBodyReminder('Alexander', shop, '1011 5th Ave N, Naples, FL 34102')).toBe(
      'TejoTime: Hi Alexander, your appointment at 5th Avenue Barber & Shave Shop starts in 15 minutes. Please head over now. Address: 1011 5th Ave N, Naples, FL 34102',
    );
    expect(smsBodyReview('Alexander', shop, 'https://www.tejotime.com/12393160008/r')).toBe(
      'TejoTime: Thanks for visiting 5th Avenue Barber & Shave Shop, Alexander! Please leave us a Google review: https://www.tejotime.com/12393160008/r Reply STOP to opt out.',
    );
  });

  it('always opens with the registered brand "TejoTime:", whatever the store is called', () => {
    for (const body of [
      smsBodyBookingConfirmed('A', shop, 'd', 't', 'l'),
      smsBodyReminder('A', shop, 'addr'),
      smsBodyReview('A', shop, 'l'),
      smsBodyReminder('A', '  ', null),
    ]) {
      expect(body.startsWith('TejoTime: ')).toBe(true);
    }
  });

  it('never puts punctuation straight after a link (handsets fold it into the URL)', () => {
    const link = 'https://x.test/p';
    for (const body of [smsBodyBookingConfirmed('A', 'S', 'Sep 1', '9:00 AM', link), smsBodyReview('A', 'S', link)]) {
      expect(body).toContain(`${link} Reply STOP`);
    }
  });

  it('STOP rides on the first message of each consent box; the reminder carries none', () => {
    expect(smsBodyBookingConfirmed('A', 'S', 'd', 't', 'l')).toMatch(/Reply STOP to opt out\.$/);
    expect(smsBodyReview('A', 'S', 'l')).toMatch(/Reply STOP to opt out\.$/);
    expect(smsBodyReminder('A', 'S', 'addr')).not.toMatch(/STOP/);
  });

  it('keeps every body GSM-7 (an em dash or curly quote forces UCS-2)', () => {
    for (const body of [
      smsBodyBookingConfirmed('A', 'S', 'Sep 1', '9:00 AM', 'l'),
      smsBodyReminder('A', 'S', 'addr'),
      smsBodyReview('A', 'S', 'l'),
    ]) {
      expect(body).not.toMatch(/[—–‘’“”]/);
    }
  });

  it('greets by first name, and falls back when name or store is blank', () => {
    expect(smsBodyReminder('Alexander Hamilton', 'S', null)).toContain('Hi Alexander,');
    // A blank store name drops "at <store>" rather than printing "at  starts".
    expect(smsBodyReminder('  ', '  ', null)).toBe(
      'TejoTime: Hi there, your appointment starts in 15 minutes. Please head over now.',
    );
    expect(smsBodyBookingConfirmed('A', ' ', 'Sep 1', '9:00 AM', 'l')).toBe(
      'TejoTime: Hi A, your appointment is confirmed for Sep 1 at 9:00 AM. Manage your booking: l Reply STOP to opt out.',
    );
    expect(smsBodyReview('A', '', 'l')).toBe(
      'TejoTime: Thanks for visiting, A! Please leave us a Google review: l Reply STOP to opt out.',
    );
  });

  it('drops the "Address:" tail when the store has no address', () => {
    expect(smsBodyReminder('A', 'S', null)).toBe(
      'TejoTime: Hi A, your appointment at S starts in 15 minutes. Please head over now.',
    );
    expect(smsBodyReminder('A', 'S', '   ')).not.toContain('Address:');
  });

  it("formats date and time on the store's clock, not UTC", () => {
    // 17:11 UTC is 1:11 PM in New York (EDT) on Sep 26 2026.
    expect(smsDateTime('2026-09-26T17:11:00.000Z', 'America/New_York')).toEqual({ date: 'Sep 26', time: '1:11 PM' });
    // 20:00 UTC is already the next day in Kolkata.
    expect(smsDateTime('2026-09-26T20:00:00.000Z', 'Asia/Kolkata')).toEqual({ date: 'Sep 27', time: '1:30 AM' });
  });
});

describe('isReminderDue', () => {
  const start = new Date('2026-09-26T17:00:00.000Z');
  const createdEarly = new Date('2026-09-25T10:00:00.000Z');
  const at = (minsBefore: number) => new Date(start.getTime() - minsBefore * 60_000);

  it('uses a 15-minute lead', () => {
    expect(REMINDER_LEAD_MINUTES).toBe(15);
  });

  it('is due inside (0, 15] minutes before the start', () => {
    expect(isReminderDue({ startAt: start, createdAt: createdEarly, now: at(15) })).toBe(true);
    expect(isReminderDue({ startAt: start, createdAt: createdEarly, now: at(1) })).toBe(true);
  });

  it('is not due earlier than 15 minutes out, or once the appointment has started', () => {
    expect(isReminderDue({ startAt: start, createdAt: createdEarly, now: at(16) })).toBe(false);
    expect(isReminderDue({ startAt: start, createdAt: createdEarly, now: at(0) })).toBe(false);
    expect(isReminderDue({ startAt: start, createdAt: createdEarly, now: at(-5) })).toBe(false);
  });

  it('skips a booking made inside the window — it just got its confirmation', () => {
    expect(isReminderDue({ startAt: start, createdAt: at(5), now: at(4) })).toBe(false);
    // Booked exactly 15 minutes ahead still gets its reminder.
    expect(isReminderDue({ startAt: start, createdAt: at(15), now: at(10) })).toBe(true);
  });
});
