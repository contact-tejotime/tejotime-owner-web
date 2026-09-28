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

// These strings ARE the Twilio A2P campaign samples (docs/sms-opt-in-a2p.md). If one of these
// expectations has to change, the registered campaign samples must change with it.
describe('sms-copy', () => {
  const shop = '5th Avenue Barber & Shave Shop';

  it('exposes exactly the three template ids', () => {
    expect(SMS_TEMPLATES).toEqual({
      bookingConfirmed: 'booking_confirmed',
      appointmentReminder: 'appointment_reminder',
      reviewRequest: 'review_request',
    });
  });

  it('renders the three registered bodies word for word', () => {
    expect(
      smsBodyBookingConfirmed('Alexander', shop, 'Sep 26', '1:11 PM', 'https://www.tejotime.com/12393160008'),
    ).toBe(
      '5th Avenue Barber & Shave Shop: Hi Alexander, your appointment is confirmed for Sep 26 at 1:11 PM. Manage your booking: https://www.tejotime.com/12393160008 Reply STOP to opt out.',
    );
    expect(smsBodyReminder('Alexander', shop, '1011 5th Ave N, Naples, FL 34102')).toBe(
      '5th Avenue Barber & Shave Shop: Hi Alexander, your appointment starts in 15 minutes. Please head over now. Address: 1011 5th Ave N, Naples, FL 34102',
    );
    expect(smsBodyReview('Alexander', shop, 'https://g.page/r/abc/review')).toBe(
      '5th Avenue Barber & Shave Shop: Thanks for visiting, Alexander! Please leave us a Google review: https://g.page/r/abc/review Reply STOP to opt out.',
    );
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
    expect(smsBodyReminder('  ', '  ', null)).toMatch(/^TejoTime: Hi there,/);
  });

  it('drops the "Address:" tail when the store has no address', () => {
    expect(smsBodyReminder('A', 'S', null)).toBe('S: Hi A, your appointment starts in 15 minutes. Please head over now.');
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
