# Data model (Cloudflare D1 / SQLite)

Defined in `worker/db.ts` and applied automatically. Append new migrations to `MIGRATIONS`; never edit a shipped one.

| Table | Purpose |
| --- | --- |
| `roles`, `users`, `sessions`, `login_attempts` | Administrators. Trigger `users_max_four_admins` caps admin accounts at four; roles cannot be changed. |
| `seasons`, `conferences`, `teams`, `team_seasons` | League structure. `team_seasons` holds per-season conference, ratings, schemes, run/pass ratio, tempo. |
| `players`, `roster_memberships`, view `depth_charts` | A player identity plus one membership per season: team, jersey, primary and secondary positions, depth rank, rating, active flag, awards. |
| `game_statuses`, `games` | The schedule. One row per matchup; every page reads the same row. |
| `percentage_snapshots`, `percentage_snapshot_entries` | Immutable imports/fetches of Activity / Upset / Star (plus extra categories). |
| `simulation_configurations` | Editable engine settings per season. |
| `simulation_runs` | Immutable simulation and import records: seed, snapshot, full result JSON (plays, drives, statistics, highlights, recap, percentage checks, validation). Only `status` may change; rows cannot be deleted. |
| `published_results` | Version history of official results. A unique index allows one current version per game. |
| `drives`, `play_events`, `scoring_events`, `player_game_stats`, `team_game_stats`, `highlights` | The official, queryable copy of the current published result for each game. Replaced inside the publish transaction. |
| `rankings` | AP-style polls, per season and week. Independent of standings. |
| `audit_logs` | Append-only record of every administrative action with previous value, new value and reason. |
| `settings` | Key/value (external percentage endpoint). |

**Aggregates are never stored.** Records, standings, season and career statistics and leaderboards are computed by
SQL over the official tables, restricted to games that are final, published and past any replay. Publishing, correcting
or withdrawing a game therefore updates every total at once and cannot double-count.

**Publishing is one transaction** (`worker/publish.ts`): guard statements abort it if the result is not approved or if
another administrator changed the official result in the meantime; then the old official rows are removed, the new
ones inserted, the version recorded, the game marked final and the audit entry written — all or nothing.
