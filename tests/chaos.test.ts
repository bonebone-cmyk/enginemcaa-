import { describe, expect, it } from 'vitest';
import { allValid, simulateGame } from '../engine/index';
import { severityWeights } from '../engine/injuries';
import type { GameResult } from '../engine/types';
import { makeTeam } from './fixtures';

const run = (seed: string, config: Record<string, unknown> = {}, a = makeTeam('AAA', { rating: 68 }), h = makeTeam('HHH', { rating: 80 })) => simulateGame({ seed, teams: [a, h], config });
const many = (n: number, config: Record<string, unknown>, f: (r: GameResult) => number) => { let t = 0; for (let i = 0; i < n; i++) t += f(run(`c-${i}`, config)); return t / n; };

describe('chaos meter', () => {
  it('leaves games unchanged at the default of 25', () => {
    const a = run('same', { injuries: false }), b = run('same', { injuries: false, chaos: 25 });
    expect(JSON.stringify(a.plays)).toBe(JSON.stringify(b.plays));
  });
  it('makes scores higher and upsets more common as it goes up', () => {
    const pts = (c: number) => many(250, { chaos: c, injuries: false }, (r) => r.final[0] + r.final[1]);
    const upsets = (c: number) => many(400, { chaos: c, injuries: false }, (r) => (r.final[0] > r.final[1] ? 1 : 0));
    expect(pts(90)).toBeGreaterThan(pts(25) + 8);
    expect(pts(0)).toBeLessThan(pts(25));
    expect(upsets(100)).toBeGreaterThan(upsets(25) + 0.05);
  });
  it('keeps every game valid even at maximum chaos', () => {
    for (let i = 0; i < 80; i++) expect(allValid(run(`max-${i}`, { chaos: 100 }))).toBe(true);
  });
});

describe('injuries', () => {
  const tally = (chaos: number, n = 600) => {
    const out = { games: 0, total: 0, short: 0, multi: 0, long: 0 };
    for (let i = 0; i < n; i++) {
      const r = run(`inj-${chaos}-${i}`, { chaos });
      out.games++;
      for (const x of r.injuries!) { out.total++; if (x.kind !== 'games') out.short++; else { out.multi++; if (x.gamesOut >= 4) out.long++; } }
    }
    return out;
  };
  it('are rare-ish, mostly short, and long ones are much rarer', () => {
    const t = tally(25);
    expect(t.total / t.games).toBeGreaterThan(0.1);
    expect(t.total / t.games).toBeLessThan(0.6);
    expect(t.short).toBeGreaterThan(t.multi * 2);
    expect(t.long).toBeLessThan(t.multi / 2.5);
    const w = severityWeights(25);
    const at = (n: number) => w.find((x) => x.kind === 'games' && x.gamesOut === n)!.w;
    for (let n = 1; n < 7; n++) expect(at(n + 1)).toBeLessThan(at(n));
  });
  it('happen more often and more seriously with more chaos, and not at all when turned off', () => {
    const calm = tally(25), wild = tally(100);
    expect(wild.total).toBeGreaterThan(calm.total * 2);
    expect(wild.long / wild.total).toBeGreaterThan(calm.long / Math.max(1, calm.total));
    expect(tally(100, 100 /* games */).total).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) expect(run(`off-${i}`, { chaos: 100, injuries: false }).injuries).toEqual([]);
  });
  it('keep injured players out, return quarter injuries next quarter, and never take a team\'s only QB', () => {
    let quarterReturns = 0;
    const solo = makeTeam('AAA', { rating: 68 });
    solo.roster = solo.roster.filter((p) => p.id !== 'AAA-QB2');
    for (let i = 0; i < 300; i++) {
      const r = run(`keep-${i}`, { chaos: 100 }, solo);
      expect(allValid(r), JSON.stringify(r.validation.filter((v) => !v.ok))).toBe(true); // includes the "do not play while injured" check
      expect(r.injuries!.some((x) => x.playerId === 'AAA-QB1')).toBe(false);
      for (const x of r.injuries!.filter((y) => y.kind === 'quarter')) {
        const later = r.plays.filter((p) => p.quarter > x.quarter);
        if (later.some((p) => [p.rusher, p.target, p.passer, ...(p.tacklers ?? [])].includes(x.playerId))) quarterReturns++;
      }
      for (const p of r.plays.filter((q) => q.injury)) expect(p.desc).toMatch(/was injured on the play/);
    }
    expect(quarterReturns).toBeGreaterThan(0);
  });
});
