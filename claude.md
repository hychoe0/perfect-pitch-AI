# Perfect Pitch AI

Intelligent pitch-calling system for catchers. Recommends the optimal **pitch type + PitchCom location** for every pitch in a matchup.

## Architecture

- **StatcastDataFetcher** — pulls pitcher/batter data from Baseball Savant via `pybaseball`; 24-hour disk cache under `./perfect_pitch_cache/`
- **PitcherProfile** — repertoire, count/zone/sequence tendencies, pressure splits
- **BatterProfile** — zone heat map, pitch-type vulnerabilities, count aggressiveness, discipline metrics
- **RuleEngine** — scores every (pitch_type, zone) candidate using count state, sequencing, tunneling, zone targeting, and pressure-adjusted rules
- **PitchOutcomeModel** — `HistGradientBoostingClassifier` trained on 2024–2025 Statcast data; predicts P(favorable_outcome)
- **AtBatTracker** — maintains live count, pitch history, and momentum after each recorded result
- **PerfectPitchAI** — main orchestrator combining all components

## Setup
```bash
pip install pybaseball xgboost seaborn tqdm
```

Or run Cell 2 in the notebook to auto-install.

**Kernel:** `catcher_env`

## Quick Start
```python
ai = PerfectPitchAI()
ai.load_matchup('Tyler Glasnow', 'Juan Soto')
ai.start_at_bat(inning=7, outs=1, on_base='_2_', home_score=2, away_score=2, game_type='W')
ai.get_recommendation()
```

## Core API

### Load a Matchup
```python
ai.load_matchup('Pitcher Name', 'Batter Name')
# With explicit IDs (faster, skips lookup):
ai.load_matchup('Paul Skenes', 'Aaron Judge', pitcher_id=694973, batter_id=592450)
```

### Start an At-Bat
```python
ai.start_at_bat(
    inning=7,
    outs=1,
    on_base='_2_',      # '_' = empty, '1__' / '_2_' / '__3' / '12_' etc.
    home_score=2,
    away_score=2,
    game_type='W'       # 'R' regular, 'P' playoff, 'W' World Series
)
```

### Get a Recommendation
```python
recs = ai.get_recommendation(top_n=3)
```

### Record a Result
```python
ai.record_result('FF', 2, 'foul', velocity=98.4)
# Args: pitch_type, zone (1–14), result, events='', velocity=0.0
```

### Interactive Mode
```python
ai.run_interactive()
```

## Pitch Types

| Code | Name |
|------|------|
| FF | 4-Seam Fastball |
| FT | 2-Seam Fastball |
| SI | Sinker |
| FC | Cutter |
| SL | Slider |
| ST | Sweeper |
| CU | Curveball |
| CH | Changeup |
| FS | Splitter |
| KC | Knuckle Curve |

## Zone Map (PitchCom)

Zones 1–9 = strike zone (3×3 grid), Zones 11–14 = chase zones outside.
PitchCom directions: Up-In, Up, Up-Away, In, Mid, Away, Down-In, Down, Down-Away.

## Pressure / Leverage Index

| Tier | LI Range |
|------|----------|
| Low | < 0.85 |
| Normal | 0.85 – 1.5 |
| High | 1.5 – 2.5 |
| Extreme | > 2.5 |

`game_type='W'` (World Series) adds a 2× pressure multiplier.

## Visualizations
```python
plot_zone_heatmap(ai.batter.zone_map, title='Soto — Whiff Rate', metric='whiff_rate')
plot_zone_heatmap(ai.batter.zone_map, title='Soto — Swing Rate', metric='swing_rate')
plot_repertoire(ai.pitcher)
plot_pressure(ai.pitcher, ai.batter)
plot_ab_timeline(ai.ab)
```

## Player Lookup
```python
lookup_player('First Last')   # returns MLB ID
```

## Cache

Data is cached to `./perfect_pitch_cache/` with a 24-hour TTL. Delete the folder to force a fresh fetch.

## Demo Scenario

**World Series Game 7 — Glasnow vs Soto, Bottom 7th, 1 out, runner on 2B, tied 2–2:**
```python
ai = PerfectPitchAI()
ai.load_matchup('Tyler Glasnow', 'Juan Soto')
ai.start_at_bat(inning=7, outs=1, on_base='_2_', home_score=2, away_score=2, game_type='W')

recs = ai.get_recommendation(top_n=3)           # Pitch 1 (0-0)
ai.record_result('FF', 2, 'foul', velocity=98.4)

recs = ai.get_recommendation(top_n=3)           # Pitch 2 (0-1)
ai.record_result('CU', 9, 'ball', velocity=77.0)

recs = ai.get_recommendation(top_n=3)           # Pitch 3 (1-1)
ai.record_result('ST', 7, 'swinging_strike', velocity=84.2)

recs = ai.get_recommendation(top_n=3)           # Pitch 4 (1-2)
ai.record_result('CU', 12, 'swinging_strike', events='strikeout', velocity=77.5)
```