import { describe, expect, it } from 'vitest';
import { gameKickoff, isSaturday, kickoffMs, parseSlot, weekDate } from '../engine/schedule';
import { parseRosterLines } from '../worker/admin';

describe('season calendar', () => {
  it('plays every week on the next Saturday, with a two-week gap before the championship', () => {
    expect(isSaturday('2026-09-05')).toBe(true);
    expect(isSaturday('2026-09-06')).toBe(false);
    expect(weekDate('2026-09-05', 1, 14)).toBe('2026-09-05');
    expect(weekDate('2026-09-05', 2, 14)).toBe('2026-09-12');
    expect(weekDate('2026-09-05', 13, 14)).toBe('2026-11-28');
    expect(weekDate('2026-09-05', 14, 14)).toBe('2026-12-12'); // two weeks after week 13
    expect(weekDate('2026-09-05', 15, 14)).toBe('2026-12-19'); // later weeks keep the extra week
    expect(weekDate('2026-09-05', 14, null)).toBe('2026-12-05'); // no championship break
  });
  it('understands the five kickoff times and nothing else', () => {
    for (const [v, slot] of [['noon', '12:00'], ['12', '12:00'], ['12:00', '12:00'], ['3:30', '15:30'], ['330', '15:30'], ['3:30 PM', '15:30'], ['15:30', '15:30'], ['6:30', '18:30'], ['7:30pm', '19:30'], ['10:30', '22:30'], ['', 'tbd'], ['TBD', 'tbd'], ['10:30 ET', '22:30']] as const)
      expect(parseSlot(v), v).toBe(slot);
    for (const v of ['4:00', '9:00', '1:30', 'midnight', '25:00']) expect(parseSlot(v), v).toBeNull();
  });
  it('converts Eastern kickoff times to the right instant across daylight saving', () => {
    expect(new Date(kickoffMs('2026-09-05', '15:30')).toISOString()).toBe('2026-09-05T19:30:00.000Z'); // EDT
    expect(new Date(kickoffMs('2026-11-28', '12:00')).toISOString()).toBe('2026-11-28T17:00:00.000Z'); // EST
    expect(new Date(kickoffMs('2026-10-31', '22:30')).toISOString()).toBe('2026-11-01T02:30:00.000Z');
    expect(gameKickoff({ start_date: null, championship_week: null, weeks: 14 }, 3, '12:00')).toBeNull();
  });
});

describe('player import lines', () => {
  it('reads name,positions,jersey with one or two positions and an optional jersey', () => {
    const r = parseRosterLines('name,positions,jersey\nAsh,QB,7\nWaterboy,wr/kr,#11\nStone,LB\nRiver,QB/FS,3\n\n# comment', [{ name: 'Old QB', position: 'QB' }]);
    expect(r.errors).toEqual([]);
    expect(r.players).toEqual([
      { name: 'Ash', position: 'QB', secondary: [], jersey: 7, depth: 2 },
      { name: 'Waterboy', position: 'WR', secondary: ['KR'], jersey: 11, depth: 1 },
      { name: 'Stone', position: 'LB', secondary: [], jersey: null, depth: 1 },
      { name: 'River', position: 'QB', secondary: ['FS'], jersey: 3, depth: 3 },
    ]);
  });
  it('explains every bad line', () => {
    const r = parseRosterLines('Ash,QB\nBob,XX\nCal\nDee,QB/FS/LB\nEli,RB,120\nash,WR\nOld QB,QB', [{ name: 'Old QB', position: 'QB' }]);
    expect(r.players.map((p) => p.name)).toEqual(['Ash']);
    expect(r.errors).toHaveLength(6);
    expect(r.errors.join(' ')).toMatch(/"XX" is not a position/);
    expect(r.errors.join(' ')).toMatch(/position is missing/);
    expect(r.errors.join(' ')).toMatch(/one or two positions/);
    expect(r.errors.join(' ')).toMatch(/jersey number must be 0–99/);
    expect(r.errors.join(' ')).toMatch(/listed twice/);
    expect(r.errors.join(' ')).toMatch(/already on this roster/);
  });
});
