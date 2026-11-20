import type { InjuryInfo } from './types';

export function injuryLabel(i: Pick<InjuryInfo, 'kind' | 'gamesOut'>): string {
  if (i.kind === 'quarter') return 'out for the rest of the quarter';
  if (i.kind === 'game') return 'out for the rest of the game';
  return `out for the rest of the game and the next ${i.gamesOut} game${i.gamesOut === 1 ? '' : 's'}`;
}

/** Short form for tables: "Rest of quarter", "Rest of game", "3 games". */
export function injuryShort(i: Pick<InjuryInfo, 'kind' | 'gamesOut'>): string {
  return i.kind === 'quarter' ? 'Rest of quarter' : i.kind === 'game' ? 'Rest of game' : `${i.gamesOut} game${i.gamesOut === 1 ? '' : 's'}`;
}

/** Multiplier for a chaos setting (0–100). Equals 1 at the default of 25. */
export const chaosMul = (chaos: number | undefined, k: number) => Math.max(0.15, 1 + ((chaos ?? 25) / 100 - 0.25) * k);

/**
 * Severity weights. Most injuries end a player's quarter or game; each extra game missed is rarer than the one before.
 * Chaos makes the multi-game outcomes more likely (and the steeper the injury, the more chaos moves it).
 */
export function severityWeights(chaos: number | undefined): { kind: InjuryInfo['kind']; gamesOut: number; w: number }[] {
  const s = chaosMul(chaos, 2);
  const base: [InjuryInfo['kind'], number, number][] = [['quarter', 0, 46], ['game', 0, 26], ['games', 1, 12], ['games', 2, 6.5], ['games', 3, 3.6], ['games', 4, 2.4], ['games', 5, 1.6], ['games', 6, 1.0], ['games', 7, 0.7]];
  return base.map(([kind, gamesOut, w]) => ({ kind, gamesOut, w: kind === 'games' ? w * Math.pow(s, 1 + gamesOut / 4) : w }));
}
