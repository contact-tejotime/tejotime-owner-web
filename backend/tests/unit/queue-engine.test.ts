import { describe, it, expect } from 'vitest';
import {
  estMins,
  elapsedMins,
  remainingMins,
  seatLoad,
  soonestSeat,
  buildSeatGroups,
  ticketPosition,
  EngineEntry,
  EngineStaff,
  EngineService,
} from '../../src/lib/queue-engine';

// Mirrors app/src/data/sample.ts (durations in minutes).
const services: EngineService[] = [
  { name: 'Haircut', durationMinutes: 30 },
  { name: 'Haircut & Beard', durationMinutes: 45 },
  { name: 'Hair Color', durationMinutes: 90 },
  { name: 'Hair Spa', durationMinutes: 60 },
];

const staff: EngineStaff[] = [
  { id: 'john', name: 'John', color: 'primary' },
  { id: 'lisa', name: 'Lisa', color: 'secondary' },
  { id: 'mike', name: 'Mike', color: 'amber500' },
];

function q(partial: Partial<EngineEntry> & Pick<EngineEntry, 'id' | 'name' | 'service' | 'status' | 'staffId'>): EngineEntry {
  return { source: 'walk_in', extra: 0, ...partial };
}

describe('estMins', () => {
  it('matches an exact service name', () => {
    expect(estMins(q({ id: '1', name: 'A', service: 'Haircut & Beard', status: 'waiting', staffId: 'john' }), services)).toBe(45);
  });
  it('falls back to the longest prefix match (add-on appended)', () => {
    // "Haircut + Shave" → prefix "Haircut" (30). extra adds on top.
    expect(estMins(q({ id: '1', name: 'A', service: 'Haircut + Shave', status: 'in_service', staffId: 'john', extra: 10 }), services)).toBe(40);
  });
  it('uses 20-min fallback for unknown services', () => {
    expect(estMins(q({ id: '1', name: 'A', service: 'Beard Trim', status: 'waiting', staffId: 'lisa' }), services)).toBe(20);
  });
});

describe('seatLoad & soonestSeat', () => {
  const queue: EngineEntry[] = [
    q({ id: '1', name: 'Aisha', service: 'Haircut & Beard', status: 'in_service', staffId: 'john' }), // 45
    q({ id: '2', name: 'Rahul', service: 'Hair Color', status: 'waiting', staffId: 'john' }), // 90
    q({ id: '4', name: 'Vivek', service: 'Haircut', status: 'in_service', staffId: 'lisa' }), // 30
  ];
  it('sums active minutes per seat', () => {
    expect(seatLoad(queue, 'john', services)).toBe(135);
    expect(seatLoad(queue, 'lisa', services)).toBe(30);
    expect(seatLoad(queue, 'mike', services)).toBe(0);
  });
  it('picks the lightest seat (empty Mike)', () => {
    expect(soonestSeat(queue, staff, services)).toBe('mike');
  });
});

describe('buildSeatGroups', () => {
  const queue: EngineEntry[] = [
    q({ id: '1', name: 'Aisha Khan', service: 'Haircut & Beard', status: 'in_service', staffId: 'john' }), // 45
    q({ id: '2', name: 'Rahul Mehta', service: 'Hair Color', status: 'waiting', staffId: 'john' }), // eta 45
    q({ id: '3', name: 'Sana Iqbal', service: 'Haircut', status: 'waiting', staffId: 'john' }), // eta 135
  ];
  const groups = buildSeatGroups(queue, staff, services);
  const john = groups.find((g) => g.id === 'john')!;

  it('labels the in-service card and running ETAs', () => {
    expect(john.cards[0].rightText).toBe('In service');
    expect(john.cards[1].rightText).toBe('~45 min'); // after Aisha (45)
    expect(john.cards[1].etaMinutes).toBe(45);
    expect(john.cards[2].rightText).toBe('~135 min'); // 45 + 90
  });
  it('computes seat meta', () => {
    expect(john.serving).toBe(true);
    expect(john.servingName).toBe('Aisha Khan');
    expect(john.waitingCount).toBe(2);
    expect(john.waitBadge).toBe('2 waiting');
    expect(john.clearMinutes).toBe(165); // 45 + 90 + 30
    expect(john.subLine).toBe('Serving Aisha · ~165 min');
  });
  it('marks an empty seat free/available', () => {
    const mike = groups.find((g) => g.id === 'mike')!;
    expect(mike.empty).toBe(true);
    expect(mike.free).toBe(true);
    expect(mike.waitBadge).toBe('Free');
    expect(mike.subLine).toBe('Available · ready for walk-in');
  });
  it('gives "Next up" when the seat is free', () => {
    const q2: EngineEntry[] = [q({ id: '9', name: 'Solo', service: 'Haircut', status: 'waiting', staffId: 'mike' })];
    const g = buildSeatGroups(q2, staff, services).find((x) => x.id === 'mike')!;
    expect(g.cards[0].rightText).toBe('Next up');
  });
});

describe('ticketPosition', () => {
  const queue: EngineEntry[] = [
    q({ id: '1', name: 'Aisha', service: 'Haircut & Beard', status: 'in_service', staffId: 'john' }),
    q({ id: '2', name: 'Rahul', service: 'Hair Color', status: 'waiting', staffId: 'john' }),
    q({ id: '3', name: 'Sana', service: 'Haircut', status: 'waiting', staffId: 'john' }),
  ];
  it('reports ahead + wait for a waiting ticket', () => {
    const p = ticketPosition('3', queue, staff, services);
    expect(p.ahead).toBe(2); // Aisha + Rahul ahead
    expect(p.waitMinutes).toBe(135);
    expect(p.status).toBe('waiting');
  });
  it('reports 0 ahead for the in-service ticket', () => {
    const p = ticketPosition('1', queue, staff, services);
    expect(p.ahead).toBe(0);
    expect(p.status).toBe('in_service');
  });
});

// ---- Elapsed-aware ("Swiggy-style" ticking down) ----

const NOW = new Date('2026-07-10T12:00:00.000Z');
/** ISO timestamp `mins` minutes before NOW. */
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60000).toISOString();

describe('elapsedMins & remainingMins', () => {
  it('elapsedMins floors to whole minutes and never goes negative', () => {
    expect(elapsedMins(ago(15), NOW)).toBe(15);
    expect(elapsedMins(ago(0.5), NOW)).toBe(0); // 30s → 0 whole minutes
    expect(elapsedMins(new Date(NOW.getTime() + 5 * 60000).toISOString(), NOW)).toBe(0); // future → 0
    expect(elapsedMins(null, NOW)).toBe(0);
    expect(elapsedMins('not-a-date', NOW)).toBe(0);
  });

  it('decays the in-service remainder by elapsed time', () => {
    const serving = q({ id: 's', name: 'A', service: 'Hair Color', status: 'in_service', staffId: 'john', startedAt: ago(15) });
    expect(remainingMins(serving, services, NOW)).toBe(75); // 90 − 15
  });

  it('floors an over-running service at 0 (never negative)', () => {
    const serving = q({ id: 's', name: 'A', service: 'Hair Color', status: 'in_service', staffId: 'john', startedAt: ago(120) });
    expect(remainingMins(serving, services, NOW)).toBe(0);
  });

  it('falls back to full duration when startedAt is missing', () => {
    const serving = q({ id: 's', name: 'A', service: 'Hair Color', status: 'in_service', staffId: 'john' });
    expect(remainingMins(serving, services, NOW)).toBe(90);
  });

  it('never decays a waiting entry, even if it carries a startedAt', () => {
    const waiting = q({ id: 'w', name: 'B', service: 'Hair Color', status: 'waiting', staffId: 'john', startedAt: ago(15) });
    expect(remainingMins(waiting, services, NOW)).toBe(90);
  });
});

describe('ticketPosition — live decay (acceptance scenario)', () => {
  // A 90-min Hair Color is in progress; a booking waits directly behind it.
  const scenario = (elapsed: number): EngineEntry[] => [
    q({ id: 'serving', name: 'In Chair', service: 'Hair Color', status: 'in_service', staffId: 'john', startedAt: ago(elapsed) }),
    q({ id: 'booking', name: 'Booker', service: 'Haircut', status: 'waiting', staffId: 'john' }),
  ];

  it('books at ~90, then ticks down: 75 @15m, 40 @50m, 0 @95m', () => {
    expect(ticketPosition('booking', scenario(0), staff, services, NOW).waitMinutes).toBe(90);
    expect(ticketPosition('booking', scenario(15), staff, services, NOW).waitMinutes).toBe(75);
    expect(ticketPosition('booking', scenario(50), staff, services, NOW).waitMinutes).toBe(40);
    const over = ticketPosition('booking', scenario(95), staff, services, NOW);
    expect(over.waitMinutes).toBe(0); // over-run: chair should clear any moment
    expect(over.status).toBe('waiting');
  });

  it('exposes the decaying slice as serviceRemainingMinutes (all of it, directly behind)', () => {
    const p = ticketPosition('booking', scenario(15), staff, services, NOW);
    expect(p.serviceRemainingMinutes).toBe(75);
    expect(p.serviceRemainingMinutes).toBe(p.waitMinutes);
  });

  it('the in-service customer has 0 wait and 0 decaying slice', () => {
    const p = ticketPosition('serving', scenario(15), staff, services, NOW);
    expect(p.waitMinutes).toBe(0);
    expect(p.serviceRemainingMinutes).toBe(0);
  });
});

describe('ticketPosition — no up-tick across a checkout', () => {
  // The person behind the booking must see a continuous wait when the front chair finishes
  // and the booking is promoted — not a value that drops then jerks back up.
  it('holds steady when the front service ends and the next is promoted', () => {
    const before: EngineEntry[] = [
      q({ id: 'front', name: 'Front', service: 'Hair Color', status: 'in_service', staffId: 'john', startedAt: ago(90) }), // remaining 0
      q({ id: 'booking', name: 'Booker', service: 'Haircut', status: 'waiting', staffId: 'john' }), // 30
      q({ id: 'behind', name: 'Behind', service: 'Haircut', status: 'waiting', staffId: 'john' }), // 30
    ];
    const behindBefore = ticketPosition('behind', before, staff, services, NOW).waitMinutes;

    // Front checks out (removed); booking promoted to in_service starting NOW (full 30 remaining).
    const after: EngineEntry[] = [
      q({ id: 'booking', name: 'Booker', service: 'Haircut', status: 'in_service', staffId: 'john', startedAt: ago(0) }),
      q({ id: 'behind', name: 'Behind', service: 'Haircut', status: 'waiting', staffId: 'john' }),
    ];
    const behindAfter = ticketPosition('behind', after, staff, services, NOW).waitMinutes;

    expect(behindBefore).toBe(30);
    expect(behindAfter).toBe(30);
    expect(behindAfter).toBe(behindBefore); // continuous — no jump
  });
});

describe('buildSeatGroups — backward compatible defaults', () => {
  it('serviceRemainingMinutes equals full duration when nothing has started', () => {
    const queue: EngineEntry[] = [
      q({ id: '1', name: 'Aisha', service: 'Haircut & Beard', status: 'in_service', staffId: 'john' }), // 45, no startedAt
      q({ id: '2', name: 'Rahul', service: 'Hair Color', status: 'waiting', staffId: 'john' }),
    ];
    const john = buildSeatGroups(queue, staff, services).find((g) => g.id === 'john')!;
    expect(john.serviceRemainingMinutes).toBe(45);
    expect(john.clearMinutes).toBe(135); // 45 + 90 — unchanged from pre-elapsed behaviour
  });
});
