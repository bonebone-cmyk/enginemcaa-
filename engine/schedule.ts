// Season calendar: games are played on Saturdays. Week 1 is the season's start date, each later week is the next
// Saturday, and the championship week (and anything after it) gets an extra week off, so it lands two weeks after the
// week before it. Kickoff times are one of five Eastern-time slots, or TBD.

export const KICKOFF_SLOTS = ['12:00', '15:30', '18:30', '19:30', '22:30'] as const;
export type KickoffSlot = (typeof KICKOFF_SLOTS)[number] | 'tbd';
export const SLOT_LABEL: Record<KickoffSlot, string> = { '12:00': 'Noon', '15:30': '3:30 PM', '18:30': '6:30 PM', '19:30': '7:30 PM', '22:30': '10:30 PM', tbd: 'Time TBD' };
export const TIME_ZONE = 'America/New_York';

/** Accepts noon, 12, 12:00, 3:30, 330, 3:30pm, 15:30, tbd … and returns the slot, or null if it is not one of the five times. */
export function parseSlot(raw: string | null | undefined): KickoffSlot | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/(et|est|edt)$/, '');
  if (!s || s === 'tbd' || s === 'tba') return 'tbd';
  if (s === 'noon' || s === '12' || s === '12pm' || s === '12:00' || s === '12:00pm' || s === '1200') return '12:00';
  const m = /^(\d{1,2}):?(\d{2})(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  if (m[3] === 'pm' && h < 12) h += 12;
  if (!m[3] && h < 12) h += 12; // college football kickoffs here are all afternoon/evening: "3:30" means 3:30 PM
  const key = `${h}:${min}`;
  return (KICKOFF_SLOTS as readonly string[]).includes(key) ? (key as KickoffSlot) : null;
}

export const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
export const isSaturday = (d: string) => isIsoDate(d) && new Date(`${d}T12:00:00Z`).getUTCDay() === 6;

/** The Saturday a week is played on (YYYY-MM-DD). */
export function weekDate(startDate: string, week: number, championshipWeek: number | null): string {
  const extra = championshipWeek != null && week >= championshipWeek && championshipWeek > 1 ? 1 : 0;
  const d = new Date(`${startDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * (week - 1 + extra));
  return d.toISOString().slice(0, 10);
}

/** Minutes east of UTC for Eastern time at a given instant (−240 in summer, −300 in winter). */
function etOffsetMinutes(ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ms).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000;
}

/** UTC milliseconds for a wall-clock Eastern time. TBD games are stored at noon so they sort on the right day. */
export function kickoffMs(date: string, slot: KickoffSlot): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (slot === 'tbd' ? '12:00' : slot).split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let t = wall - etOffsetMinutes(wall) * 60000;
  t = wall - etOffsetMinutes(t) * 60000;
  return t;
}

/** kickoff_at for a game, or null when the season has no start date yet. */
export function gameKickoff(season: { start_date: string | null; championship_week: number | null; weeks: number }, week: number, slot: KickoffSlot): number | null {
  if (!season.start_date) return null;
  return kickoffMs(weekDate(season.start_date, week, season.championship_week ?? season.weeks), slot);
}
