# MCAA percentages: what each one means and exactly what it does

The external MCAA percentage system is the authority. This application stores what it is given in immutable,
timestamped snapshots and never invents, defaults, averages or estimates a value.

## The rule

**Activity, Upset and Star count equally but separately.**

* Each category has its own random stream, derived from the game seed (`<seed>/pct/activity/<side>`,
  `<seed>/pct/upset/<side>`, `<seed>/pct/star/<side>`). Changing one percentage cannot change the rolls of another.
* Each check is `roll < percentage`, where `roll` is uniform on 0–100, against that category's percentage only.
* Each category feeds a different mechanism. Nowhere in the code are the three added, multiplied or averaged into
  one number (`engine/percentages.ts`; tests in `tests/engine.test.ts`, "independent percentages").

| | Activity | Upset | Star |
| --- | --- | --- | --- |
| Represents | Preparedness | Underdog potential | Individual brilliance |
| Checks per team | 5: one per quarter, one held for overtime | 2: one per half (overtime uses the second) | One per featured player: QB1, lead rusher, top receiver, top defender |
| If the check passes | "Sharp" period: +1.5 rating on both sides of the ball, 25% fewer penalties, fewer fumbles, +1% completions | "Surge" for that half, **only if the team is the underdog**: its rating rises by 60% of the pre-game rating gap, and it intercepts and recovers fumbles more often. In an even matchup (gap under 1 point) the surge is +1. A favorite gets nothing. | That player has a "star game": +12 individual rating, about 50% more touches/targets (defenders: about 90% more plays made), more explosive plays. Nobody else is affected. |
| If it fails | "Flat" period: −1.5 rating, 25% more penalties, more fumbles | No surge | A normal game for that player |
| Part of the game it touches | Execution quality, quarter by quarter | The matchup gap, half by half | Who makes the plays |

The three effect sizes are settings (Simulation Settings): `activityEffect`, `upsetGapClosure`, `starBoost`.
The "rating gap" is the difference in (offense + defense) / 2, including home-field advantage.

### Worked example

Team A: Activity 85, Upset 35, Star 70. Team B: Activity 45, Upset 65, Star 20.

* Activity: A is sharp in roughly 85% of quarters, B in roughly 45%.
* Upset: whichever of A or B is the underdog in this matchup gets a surge in a half with probability equal to its own
  Upset percentage (35% or 65%). The favorite's Upset percentage is rolled and recorded but has no effect.
* Star: each of A's four featured players independently has a 70% chance of a star game; each of B's, 20%.

A single game can have all three in play at once; they reach the scoreboard through different doors.

## Snapshots

Before every simulation the server:

1. resolves the percentages — fetches the configured endpoint, or uses the latest verified import, or the snapshot an
   administrator explicitly chose;
2. validates them (every value present, numeric, 0–100; every team recognised; no duplicates);
3. stores a snapshot with timestamp, source, source detail and checksum (database triggers forbid editing it);
4. simulates from that snapshot and stores the snapshot id on the simulation record;
5. stores every individual check — category, team, scope, percentage, roll, pass/fail, effect — in the result.

If the endpoint is unreachable or returns invalid data the simulation fails with `SOURCE_UNAVAILABLE` /
`SOURCE_INVALID`. An administrator may then pick an earlier snapshot; its age is shown in the Simulation Center and on
the review page. A team with no entry in the chosen snapshot cannot be simulated (`MISSING_PERCENTAGES`).

Results Review → "Percentages & seed" shows the source values, the snapshot time, every roll, the seed and the effects.

## Import formats

CSV (comma, semicolon or tab; `%` signs allowed):

```
team,activity,upset,star
TUL,85,35,70
Fresno State Wolves,45,65,20
```

JSON — an array, or an object with `teams` / `percentages` / `data`, or an object keyed by team:

```json
[{ "team": "TUL", "activity": 85, "upset": 35, "star": 70 }]
```

Teams are matched by id, abbreviation, short name or full name. Any extra numeric column (for example `morale`) is
stored with the snapshot as an additional category so future categories can be added without a data migration; the
engine ignores categories it has no rule for.

## CFB 27 primetime games

Percentages are **not applied** to an imported result. No check is rolled, and nothing can move the imported score.
