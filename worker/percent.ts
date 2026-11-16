// External percentage integration.
// The MCAA percentage system is the authority for Activity / Upset / Star. This module never invents a value:
// it either fetches from a configured endpoint, or validates a CSV/JSON export, and stores an immutable timestamped snapshot.
import { HttpError, sha256, type AdminUser, type Env } from './auth';
import { all, first, insertRows, j, now, stmt, uid, type DB } from './db';
import type { TeamRow } from './league';

export interface PctEntry { teamId: string; activity: number; upset: number; star: number; extra: Record<string, number> }
export interface Snapshot { id: string; season_id: string; source: string; source_detail: string | null; fetched_at: number; team_count: number; checksum: string }

const CORE = ['activity', 'upset', 'star'];
const TEAM_KEYS = ['team', 'team_id', 'teamid', 'id', 'abbr', 'name', 'school'];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t' || ch === ';') (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(content: string): Record<string, string>[] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/(percentage|percent|pct)$/, ''));
  return lines.slice(1).map((l) => Object.fromEntries(splitCsvLine(l).map((v, i) => [head[i] ?? `col${i}`, v])));
}

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.trim()) return NaN;
  return Number(v.trim().replace(/%$/, ''));
};

/** Parse and validate a percentage export. Any problem rejects the whole import; nothing is defaulted or guessed. */
export function parsePercentages(format: 'csv' | 'json', content: string, teams: TeamRow[]): { entries: PctEntry[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: Record<string, unknown>[] = [];
  if (format === 'csv') raw = parseCsv(content);
  else {
    try {
      const data = JSON.parse(content);
      const arr = Array.isArray(data) ? data : data?.teams ?? data?.percentages ?? data?.data;
      if (Array.isArray(arr)) raw = arr;
      else if (data && typeof data === 'object') raw = Object.entries(data).map(([team, v]) => ({ team, ...(v as object) }));
    } catch {
      errors.push('The JSON could not be parsed.');
    }
    raw = raw.map((r) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/(percentage|percent|pct)$/, ''), v])));
  }
  if (!raw.length && !errors.length) errors.push('No rows found. Expected a header row with: team, activity, upset, star.');
  const byKey = new Map<string, TeamRow>();
  for (const t of teams) for (const k of [t.id, t.abbr, t.name, t.short_name]) byKey.set(k.toLowerCase(), t);
  const seen = new Set<string>();
  const entries: PctEntry[] = [];
  raw.forEach((r, i) => {
    const row = `Row ${i + 1}`;
    const key = TEAM_KEYS.map((k) => r[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    if (!key) return void errors.push(`${row}: no team column (expected one of: team, abbr, name, id).`);
    const t = byKey.get(key.trim().toLowerCase());
    if (!t) return void errors.push(`${row}: team "${key}" does not match any MCAA team name, short name, abbreviation or id.`);
    if (seen.has(t.id)) return void errors.push(`${row}: ${t.name} appears more than once.`);
    seen.add(t.id);
    const vals: Record<string, number> = {};
    for (const c of CORE) {
      const n = toNum(r[c]);
      if (!Number.isFinite(n)) errors.push(`${row} (${t.name}): ${c} percentage is missing or not a number.`);
      else if (n < 0 || n > 100) errors.push(`${row} (${t.name}): ${c} percentage ${n} is outside 0-100.`);
      vals[c] = n;
    }
    const extra: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (CORE.includes(k) || TEAM_KEYS.includes(k)) continue;
      const n = toNum(v);
      if (Number.isFinite(n) && n >= 0 && n <= 100) extra[k] = n;
    }
    entries.push({ teamId: t.id, activity: vals.activity, upset: vals.upset, star: vals.star, extra });
  });
  const missing = teams.filter((t) => t.in_season && !seen.has(t.id));
  if (missing.length && !errors.length) warnings.push(`No percentages supplied for: ${missing.map((t) => t.name).join(', ')}. Their games cannot be simulated from this snapshot.`);
  return { entries: errors.length ? [] : entries, errors, warnings };
}

export async function saveSnapshot(db: DB, seasonId: string, source: string, detail: string | null, entries: PctEntry[], admin: AdminUser | null): Promise<Snapshot> {
  if (!entries.length) throw new HttpError(422, 'A snapshot needs at least one team.');
  const id = uid();
  const canonical = JSON.stringify([...entries].sort((a, b) => a.teamId.localeCompare(b.teamId)));
  const snap: Snapshot = { id, season_id: seasonId, source, source_detail: detail, fetched_at: now(), team_count: entries.length, checksum: await sha256(canonical) };
  await db.batch([
    stmt(db, 'INSERT INTO percentage_snapshots (id, season_id, source, source_detail, fetched_at, created_by, checksum, team_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)', id, seasonId, source, detail, snap.fetched_at, admin?.id ?? null, snap.checksum, entries.length),
    insertRows(db, 'percentage_snapshot_entries', ['snapshot_id', 'team_id', 'activity', 'upset', 'star', 'extra'], entries.map((e) => ({ snapshot_id: id, team_id: e.teamId, activity: e.activity, upset: e.upset, star: e.star, extra: e.extra }))),
  ]);
  return snap;
}

export async function apiUrl(env: Env, db: DB): Promise<string | null> {
  const fromSetting = await first<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'percentage_api_url'");
  const url = (fromSetting?.value || env.PERCENTAGE_API_URL || '').trim();
  return url || null;
}

/** Pull current percentages from the configured external endpoint. Throws 502 when the source cannot be reached or is malformed. */
export async function fetchExternal(env: Env, db: DB, seasonId: string, teams: TeamRow[], admin: AdminUser | null): Promise<{ snapshot: Snapshot; warnings: string[] }> {
  const url = await apiUrl(env, db);
  if (!url) throw new HttpError(400, 'No external percentage endpoint is configured. Import a CSV or JSON export instead, or set the endpoint in Percentage Integration.', { code: 'NO_SOURCE' });
  let text: string;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...(env.PERCENTAGE_API_TOKEN ? { Authorization: `Bearer ${env.PERCENTAGE_API_TOKEN}` } : {}) }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    throw new HttpError(502, `The external percentage source is unavailable (${(e as Error).message}). You may select a previously verified snapshot instead.`, { code: 'SOURCE_UNAVAILABLE' });
  }
  const parsed = parsePercentages(text.trim().startsWith('{') || text.trim().startsWith('[') ? 'json' : 'csv', text, teams);
  if (parsed.errors.length) throw new HttpError(502, 'The external percentage source returned data that failed validation.', { code: 'SOURCE_INVALID', details: parsed.errors });
  return { snapshot: await saveSnapshot(db, seasonId, 'api', url, parsed.entries, admin), warnings: parsed.warnings };
}

export async function snapshotEntries(db: DB, snapshotId: string): Promise<Map<string, { activity: number; upset: number; star: number; extra: Record<string, number> }>> {
  const rows = await all<{ team_id: string; activity: number; upset: number; star: number; extra: string }>(db, 'SELECT * FROM percentage_snapshot_entries WHERE snapshot_id = ?1', snapshotId);
  return new Map(rows.map((r) => [r.team_id, { activity: r.activity, upset: r.upset, star: r.star, extra: j(r.extra, {}) }]));
}

/**
 * Decide which snapshot a simulation uses.
 *  - explicit snapshotId: an administrator deliberately chose a previously verified snapshot (its age is shown in the UI);
 *  - endpoint configured: fetch fresh values now and snapshot them; if the source is down the request fails and the
 *    administrator must choose a snapshot explicitly;
 *  - import-only: the most recent verified import is the current data.
 */
export async function resolveSnapshot(env: Env, db: DB, seasonId: string, teams: TeamRow[], admin: AdminUser, snapshotId?: string | null): Promise<Snapshot> {
  if (snapshotId) {
    const s = await first<Snapshot>(db, 'SELECT * FROM percentage_snapshots WHERE id = ?1 AND season_id = ?2', snapshotId, seasonId);
    if (!s) throw new HttpError(404, 'That percentage snapshot does not exist for this season.');
    return s;
  }
  if (await apiUrl(env, db)) return (await fetchExternal(env, db, seasonId, teams, admin)).snapshot;
  const latest = await first<Snapshot>(db, 'SELECT * FROM percentage_snapshots WHERE season_id = ?1 ORDER BY fetched_at DESC LIMIT 1', seasonId);
  if (!latest) throw new HttpError(422, 'No team percentages have been imported for this season. Import them in Percentage Integration before simulating.', { code: 'NO_PERCENTAGES' });
  return latest;
}
