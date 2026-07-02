import { describe, it, expect } from 'vitest';
import {
  estMins,
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
