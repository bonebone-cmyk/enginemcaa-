import { Check as CheckIcon, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GameResult } from '../../../engine/types';
import { qs, useApi } from '../../api';
import { useSeason } from '../../shared';
import { Badge, Button, Card, Empty, Load, Notice, Select, cx } from '../../ui';
import { BOX, teamLine } from '../Game';
import { derive, useTeams } from './sim';

type Row = Record<string, any>;
type Format = 'text' | 'sheet';

const cell = (v: unknown, dp?: number) => (typeof v === 'number' && dp ? v.toFixed(dp) : String(v ?? 0));

/** One section of a team's box score as rows of strings: [header, ...players, Team?]. Nothing is recomputed: values come from the stored result. */
function sectionRows(b: (typeof BOX)[number], players: Row[], team: Row | undefined): string[][] | null {
  const rows = players.filter(b.filter).sort((x, y) => y[b.sort] - x[b.sort]);
  const tl = teamLine(team, b.title);
  if (!rows.length && !tl) return null;
  const out = [['Player', 'Pos', '#', ...b.cols.map((c) => c[1])]];
  for (const p of rows) out.push([p.name, p.position ?? '', p.jersey != null ? String(p.jersey) : '', ...b.cols.map((c) => cell(p[c[0]], c[2]))]);
  if (tl) out.push(['Team', '', '', ...b.cols.map((c) => cell(tl[c[0]], c[2]))]);
  return out;
}

function render(fmt: Format, heading: string, sections: [string, string[][]][]): string {
  if (fmt === 'sheet') return [heading, '', ...sections.flatMap(([t, rows]) => [t.toUpperCase(), ...rows.map((r) => r.join('\t')), ''])].join('\n').trimEnd();
  const blocks = sections.map(([t, rows]) => {
    // Plain text: player name + position in one column, numbers right-aligned.
    const r2 = rows.map((r, i) => [i === 0 ? t.toUpperCase() : r[1] ? `${r[0]} (${r[1]}${r[2] ? ` #${r[2]}` : ''})` : r[0], ...r.slice(3)]);
    const w = r2[0].map((_, k) => Math.max(...r2.map((r) => r[k].length)));
    return r2.map((r) => r.map((v, k) => (k === 0 ? v.padEnd(w[k]) : v.padStart(w[k]))).join('  ').trimEnd()).join('\n');
  });
  return [heading, '', ...blocks.flatMap((b) => [b, ''])].join('\n').trimEnd();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function CopyStats() {
  const { seasonId } = useSeason();
  const team = useTeams();
  const [params, setParams] = useSearchParams();
  const gameId = params.get('game') ?? '';
  const games = useApi<any>(`/admin/games${qs({ season: seasonId })}`);
  const withStats: Row[] = (games.data?.games ?? []).filter((g: Row) => g.run);
  const game = withStats.find((g) => g.id === gameId);
  const detail = useApi<any>(game ? `/admin/runs/${game.run.id}` : null);
  const [side, setSide] = useState<0 | 1 | 'both'>(0);
  const [fmt, setFmt] = useState<Format>('text');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold uppercase">Copy Stats</h1>
      <p className="max-w-3xl text-sm text-ink-300">Copy a team's player statistics from a game that already has a result, to paste into a message, a document or a spreadsheet. This only reads the stored stats; nothing is changed.</p>
      <Card title="Game">
        <Load q={games}>{() => withStats.length ? (
          <Select value={gameId} onChange={(e) => { setParams(e.target.value ? { game: e.target.value } : {}); setCopied(false); }}>
            <option value="">Select a game…</option>
            {withStats.map((g) => <option key={g.id} value={g.id}>Week {g.week}: {team(g.away_team_id).name} {g.run.away_score}, {team(g.home_team_id).name} {g.run.home_score}{g.run.status === 'published' ? '' : ` (${g.run.status === 'candidate' ? 'awaiting review' : 'approved, not published'})`}</option>)}
          </Select>) : <Empty>No games in this season have a result yet. Simulate or import a game first.</Empty>}
        </Load>
      </Card>
      {game && <Load q={detail}>{(d) => <Body d={d} side={side} setSide={setSide} fmt={fmt} setFmt={setFmt} off={off} setOff={setOff} copied={copied} setCopied={setCopied} team={team} />}</Load>}
    </div>
  );
}

function Body({ d, side, setSide, fmt, setFmt, off, setOff, copied, setCopied, team }: {
  d: Row; side: 0 | 1 | 'both'; setSide: (s: 0 | 1 | 'both') => void; fmt: Format; setFmt: (f: Format) => void; off: Set<string>; setOff: (s: Set<string>) => void; copied: boolean; setCopied: (b: boolean) => void; team: (id: string) => Row;
}) {
  const r: GameResult = d.result;
  const g = d.game;
  const names = [team(g.away_team_id).name, team(g.home_team_id).name];
  const text = useMemo(() => {
    const players: Row[] = r.playerStats.map((l) => ({ ...derive(l as unknown as Row), name: d.players[l.playerId]?.name ?? 'Unknown player', position: d.players[l.playerId]?.position, jersey: d.players[l.playerId]?.jersey }));
    const label = r.mode === 'primetime' ? 'CFB 27 result' : 'Simulated';
    const score = `${names[0]} ${r.final[0]}, ${names[1]} ${r.final[1]} — Week ${g.week} (${label})`;
    const one = (s: 0 | 1) => {
      const secs = BOX.filter((b) => !off.has(b.title)).map((b) => [b.title, sectionRows(b, players.filter((p) => p.side === s), r.teamStats[s] as unknown as Row)] as [string, string[][] | null]).filter((x): x is [string, string[][]] => !!x[1]);
      return render(fmt, `${score}\n${names[s]} player stats`, secs);
    };
    return side === 'both' ? `${one(0)}\n\n${one(1)}` : one(side);
  }, [r, d.players, side, fmt, off, g.week, names[0], names[1]]);
  const go = async () => { await copyText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const toggle = (t: string) => { const n = new Set(off); n.has(t) ? n.delete(t) : n.add(t); setOff(n); setCopied(false); };

  return (
    <Card title="Player stats" action={d.run.status !== 'published' && <Badge tone="gold">Not published yet</Badge>}>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Team</p>
          <div className="flex flex-wrap gap-1">{([[0, `${names[0]} (away)`], [1, `${names[1]} (home)`], ['both', 'Both teams']] as const).map(([v, l]) => <Button key={String(v)} size="sm" variant={side === v ? 'primary' : 'outline'} onClick={() => { setSide(v); setCopied(false); }}>{l}</Button>)}</div></div>
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Format</p>
          <div className="flex gap-1"><Button size="sm" variant={fmt === 'text' ? 'primary' : 'outline'} onClick={() => { setFmt('text'); setCopied(false); }}>Text</Button><Button size="sm" variant={fmt === 'sheet' ? 'primary' : 'outline'} onClick={() => { setFmt('sheet'); setCopied(false); }}>Spreadsheet</Button></div></div>
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Sections</p>
          <div className="flex flex-wrap gap-1">{BOX.map((b) => <button key={b.title} onClick={() => toggle(b.title)} className={cx('rounded-full px-2.5 py-1 text-xs ring-1', off.has(b.title) ? 'text-ink-400 ring-ink-600' : 'bg-gold/15 text-gold-soft ring-gold/40')}>{b.title}</button>)}</div></div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={go}>{copied ? <CheckIcon className="size-4" /> : <Copy className="size-4" />}{copied ? 'Copied' : 'Copy stats'}</Button>
        <span className="text-xs text-ink-400">{fmt === 'sheet' ? 'Pastes into Google Sheets or Excel with one value per cell.' : 'Lined-up columns for messages and documents (use a monospace font to keep them aligned).'}</span>
      </div>
      {r.mode === 'primetime' && <Notice className="mt-3">This game is a CFB 27 reconstruction: the score is real, and only stats that were locked at import are real values; the rest were generated to fit the score.</Notice>}
      <pre aria-label="Stats preview" className="scroll-x mt-3 max-h-[32rem] overflow-y-auto rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-xs leading-relaxed text-ink-100">{text}</pre>
    </Card>
  );
}
