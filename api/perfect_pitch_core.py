"""
Perfect Pitch AI — Core Engine
Extracted from perfect_pitch.ipynb for use with the FastAPI backend.
"""

import warnings, os, pickle, time, json, urllib.request, hashlib
import joblib
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np

from pybaseball import statcast_pitcher, statcast_batter, playerid_lookup
import pybaseball
pybaseball.cache.enable()

from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, brier_score_loss
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV

# ── Seasons ───────────────────────────────────────────────────────────────────
SEASONS = {
    '2024': ('2024-03-28', '2024-11-01'),
    '2025': ('2025-03-27', '2025-10-01'),
}

# ── Pitch types ───────────────────────────────────────────────────────────────
PITCH_TYPES = {
    'FF': '4-Seam Fastball',
    'FT': '2-Seam Fastball',
    'SI': 'Sinker',
    'FC': 'Cutter',
    'SL': 'Slider',
    'ST': 'Sweeper',
    'CU': 'Curveball',
    'KC': 'Knuckle Curve',
    'CH': 'Changeup',
    'FS': 'Splitter',
}

# ── PitchCom zone mapping (catcher view) ──────────────────────────────────────
#  Strike zones:  1|2|3 (top row)  4|5|6 (mid)  7|8|9 (bot)
#  Shadow zones:  11=above  12=below  13=inside(left)  14=away(right)
#  Ball zone:     10=outside all shadow zones
ZONE_TO_PITCHCOM = {
    1:  {'dir': 'Up-In',      'desc': 'Up and in'},
    2:  {'dir': 'Up',         'desc': 'Up in the zone'},
    3:  {'dir': 'Up-Away',    'desc': 'Up and away'},
    4:  {'dir': 'In',         'desc': 'Middle-in'},
    5:  {'dir': 'Middle',     'desc': 'Middle of zone'},
    6:  {'dir': 'Away',       'desc': 'Middle-away'},
    7:  {'dir': 'Down-In',    'desc': 'Down and in'},
    8:  {'dir': 'Down',       'desc': 'Down in zone'},
    9:  {'dir': 'Down-Away',  'desc': 'Down and away'},
    10: {'dir': 'Ball',       'desc': 'Clearly outside zone'},
    11: {'dir': 'Chase-Up',   'desc': 'Above the zone (chase)'},
    12: {'dir': 'Chase-Down', 'desc': 'Below the zone (chase)'},
    13: {'dir': 'Chase-In',   'desc': 'Off plate inside (chase)'},
    14: {'dir': 'Chase-Away', 'desc': 'Off plate outside (chase)'},
}

# ── Known player IDs by position ──────────────────────────────────────────────
KNOWN_PITCHERS = {
    'Tyler Glasnow':   607192,
    'Gerrit Cole':     543037,
    'Paul Skenes':     694973,
    'Zack Wheeler':    554430,
    'Shohei Ohtani':   660271,
}

KNOWN_BATTERS = {
    'Juan Soto':       665742,
    'Shohei Ohtani':   660271,
    'Freddie Freeman': 518692,
    'Aaron Judge':     592450,
    'Mookie Betts':    605141,
}

# Combined (for backward compatibility / ID lookup)
KNOWN_PLAYERS = {**KNOWN_PITCHERS, **KNOWN_BATTERS}

# ── Outcome sets ──────────────────────────────────────────────────────────────
SWING_DESC  = {'swinging_strike','swinging_strike_blocked','foul',
               'foul_tip','hit_into_play','hit_into_play_no_out','hit_into_play_score'}
WHIFF_DESC  = {'swinging_strike','swinging_strike_blocked'}
FAVORABLE_DESC   = {'swinging_strike','swinging_strike_blocked','called_strike','foul_tip'}
FAVORABLE_EVENTS = {'strikeout','field_out','grounded_into_double_play',
                    'force_out','fielders_choice','fielders_choice_out',
                    'sac_fly','sac_bunt','double_play'}
POSTSEASON = {'D','L','W'}


# ─────────────────────────────────────────────────────────────────────────────
# DATA FETCHER
# ─────────────────────────────────────────────────────────────────────────────
class StatcastDataFetcher:
    """Fetches pitcher/batter Statcast data. Caches to disk (24-hour TTL)."""

    def __init__(self, cache_dir='./perfect_pitch_cache'):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    def _path(self, key):
        return os.path.join(self.cache_dir, f'{key}.pkl')

    def _load(self, key):
        p = self._path(key)
        if os.path.exists(p) and (time.time() - os.path.getmtime(p)) / 3600 < 24:
            with open(p, 'rb') as f:
                return pickle.load(f)
        return None

    def _save(self, key, data):
        with open(self._path(key), 'wb') as f:
            pickle.dump(data, f)

    def get_pitcher_data(self, player_id: int, name: str) -> pd.DataFrame:
        key = f'pitcher_{player_id}'
        cached = self._load(key)
        if cached is not None:
            print(f'  [Cache] {name}: {len(cached):,} pitches')
            return cached
        frames = []
        for season, (start, end) in SEASONS.items():
            try:
                print(f'  [Fetch] {name} {season}...', end=' ', flush=True)
                df = statcast_pitcher(start_dt=start, end_dt=end, player_id=player_id)
                if df is not None and len(df) > 0:
                    df['season'] = int(season)
                    frames.append(df)
                    print(f'{len(df):,} pitches')
                else:
                    print('no data')
                time.sleep(1)
            except Exception as e:
                print(f'ERROR: {e}')
        if not frames:
            raise ValueError(f'No pitcher data for {name} (ID={player_id})')
        result = pd.concat(frames, ignore_index=True)
        self._save(key, result)
        return result

    def get_batter_data(self, player_id: int, name: str) -> pd.DataFrame:
        key = f'batter_{player_id}'
        cached = self._load(key)
        if cached is not None:
            print(f'  [Cache] {name}: {len(cached):,} pitches')
            return cached
        frames = []
        for season, (start, end) in SEASONS.items():
            try:
                print(f'  [Fetch] {name} {season}...', end=' ', flush=True)
                df = statcast_batter(start_dt=start, end_dt=end, player_id=player_id)
                if df is not None and len(df) > 0:
                    df['season'] = int(season)
                    frames.append(df)
                    print(f'{len(df):,} pitches')
                else:
                    print('no data')
                time.sleep(1)
            except Exception as e:
                print(f'ERROR: {e}')
        if not frames:
            raise ValueError(f'No batter data for {name} (ID={player_id})')
        result = pd.concat(frames, ignore_index=True)
        self._save(key, result)
        return result


def lookup_player(name: str) -> Optional[int]:
    """Look up MLB player ID by name. Returns MLB ID or None."""
    if name in KNOWN_PLAYERS:
        return KNOWN_PLAYERS[name]
    parts = name.strip().split()
    if len(parts) < 2:
        return None
    try:
        result = playerid_lookup(parts[-1], parts[0])
        if len(result) == 0:
            return None
        if 'mlb_played_last' in result.columns:
            result = result.sort_values('mlb_played_last', ascending=False)
        return int(result.iloc[0]['key_mlbam'])
    except Exception:
        return None


def _fetch_handedness(mlb_ids: List[int]) -> Dict[int, dict]:
    """Batch-fetch pitchHand, batSide, currentTeam, primaryPosition from the MLB Stats API."""
    if not mlb_ids:
        return {}
    ids_str = ','.join(str(i) for i in mlb_ids)
    url = (f'https://statsapi.mlb.com/api/v1/people'
           f'?personIds={ids_str}'
           f'&fields=people,id,pitchHand,batSide,currentTeam,primaryPosition')
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        return {
            p['id']: {
                'throws':   p.get('pitchHand', {}).get('code', ''),
                'bats':     p.get('batSide',   {}).get('code', ''),
                'team':     p.get('currentTeam', {}).get('abbreviation', ''),
                'position': p.get('primaryPosition', {}).get('abbreviation', ''),
            }
            for p in data.get('people', [])
        }
    except Exception:
        return {}


def search_players(query: str) -> List[dict]:
    """Search all MLB Statcast players by name via pybaseball lookup."""
    q = query.strip()
    if len(q) < 2:
        return []

    parts = q.split()
    last  = parts[-1]
    first = parts[0] if len(parts) > 1 else ''

    try:
        result = playerid_lookup(last, first, fuzzy=True)
        if result is None or len(result) == 0:
            return []

        result = result[result['key_mlbam'].notna()].copy()

        # Limit to Statcast era (2015+)
        if 'mlb_played_last' in result.columns:
            result = result[result['mlb_played_last'] >= 2015]
            result = result.sort_values('mlb_played_last', ascending=False)

        out = []
        for _, row in result.head(20).iterrows():
            mlb_id = int(row['key_mlbam'])
            name_first = str(row.get('name_first', '')).strip().title()
            name_last  = str(row.get('name_last',  '')).strip().title()
            full_name  = f'{name_first} {name_last}'.strip()
            if full_name and mlb_id:
                out.append({'name': full_name, 'id': mlb_id})

        # Batch-fetch handedness, team, position in one MLB Stats API call
        hand_map = _fetch_handedness([p['id'] for p in out])
        for p in out:
            h = hand_map.get(p['id'], {})
            p['throws']   = h.get('throws',   '')
            p['bats']     = h.get('bats',     '')
            p['team']     = h.get('team',     '')
            p['position'] = h.get('position', '')

        return out
    except Exception:
        ql = q.lower()
        return [{'name': n, 'id': i} for n, i in KNOWN_PLAYERS.items()
                if ql in n.lower()]


# ──────────────────────────────────────────────────────────────���──────────────
# LEVERAGE INDEX & PRESSURE METRICS
# ─────────────────────────────────────────────────────────────────────────────
PRESSURE_TIERS = {
    'Low':     (0.0,  0.85),
    'Normal':  (0.85, 1.5),
    'High':    (1.5,  2.5),
    'Extreme': (2.5,  10.0),
}


def compute_leverage(row) -> float:
    """Return a leverage score [0.1, 5.0] for a Statcast row or dict."""
    score = 1.0
    try:
        diff = abs(int(row.get('home_score', 0)) - int(row.get('away_score', 0)))
    except Exception:
        diff = 0
    if   diff == 0: score *= 1.5
    elif diff == 1: score *= 1.3
    elif diff == 2: score *= 1.1
    elif diff >= 5: score *= 0.35

    try:
        inning = int(row.get('inning', 1))
    except Exception:
        inning = 1
    if   inning >= 9: score *= 2.0
    elif inning >= 7: score *= 1.6
    elif inning >= 5: score *= 1.2
    else:             score *= 0.85

    on_2b = 1 if pd.notna(row.get('on_2b')) else 0
    on_3b = 1 if pd.notna(row.get('on_3b')) else 0
    on_1b = 1 if pd.notna(row.get('on_1b')) else 0
    runners = on_1b + on_2b + on_3b
    if on_2b or on_3b: score *= 1.3
    if runners == 3:   score *= 1.2

    try:
        outs = int(row.get('outs_when_up', 0))
    except Exception:
        outs = 0
    if outs == 2: score *= 1.1

    gt = str(row.get('game_type', 'R'))
    if   gt == 'W': score *= 2.5
    elif gt == 'L': score *= 2.0
    elif gt == 'D': score *= 1.7

    return round(min(score, 5.0), 3)


def add_leverage(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['leverage'] = df.apply(compute_leverage, axis=1)
    return df


def _tier_stats_pitcher(sub: pd.DataFrame) -> Optional[dict]:
    n = len(sub)
    if n == 0:
        return None
    swings = sub[sub['description'].isin(SWING_DESC)]
    whiffs = sub[sub['description'].isin(WHIFF_DESC)]
    in_z   = sub[sub['zone'].between(1, 9)]
    out_z  = sub[sub['zone'].isin([11,12,13,14])]
    chase  = out_z[out_z['description'].isin(SWING_DESC)]
    ks     = sub[sub['events'] == 'strikeout']
    return {
        'n':          n,
        'whiff_rate': len(whiffs) / len(swings) if len(swings) > 0 else 0,
        'zone_rate':  len(in_z)  / n,
        'chase_rate': len(chase) / len(out_z) if len(out_z) > 0 else 0,
        'k_rate':     len(ks)    / n * 100,
    }


def _tier_stats_batter(sub: pd.DataFrame) -> Optional[dict]:
    n = len(sub)
    if n == 0:
        return None
    swings = sub[sub['description'].isin(SWING_DESC)]
    whiffs = sub[sub['description'].isin(WHIFF_DESC)]
    out_z  = sub[sub['zone'].isin([11,12,13,14])]
    chase  = out_z[out_z['description'].isin(SWING_DESC)]
    pas    = sub[sub['events'].notna()]
    ks     = sub[sub['events'] == 'strikeout']
    return {
        'n':          n,
        'swing_rate': len(swings) / n,
        'whiff_rate': len(whiffs) / len(swings) if len(swings) > 0 else 0,
        'chase_rate': len(chase)  / len(out_z)  if len(out_z)  > 0 else 0,
        'k_rate':     len(ks)     / len(pas)     if len(pas)    > 0 else 0,
    }


def pitcher_pressure_profile(df: pd.DataFrame) -> dict:
    """Pitcher effectiveness split by pressure tier + postseason."""
    df = add_leverage(df)
    df = df[df['pitch_type'].isin(PITCH_TYPES)]
    out = {}
    for tier, (lo, hi) in PRESSURE_TIERS.items():
        mask = (df['leverage'] >= lo) & (df['leverage'] < hi)
        s = _tier_stats_pitcher(df[mask])
        if s: out[tier] = s
    for label, mask in [('Postseason', df['game_type'].isin(POSTSEASON)),
                        ('Regular',    df['game_type'] == 'R')]:
        s = _tier_stats_pitcher(df[mask])
        if s: out[label] = s
    if 'High' in out and 'Normal' in out:
        d = out['High']['whiff_rate'] - out['Normal']['whiff_rate']
        if   d >  0.03: interp = 'CLUTCH — Pitcher BETTER under pressure'
        elif d < -0.03: interp = 'SHAKY — Pitcher WORSE under pressure'
        else:           interp = 'CONSISTENT — Stable under pressure'
        out['clutch_delta'] = {'whiff_delta': round(d, 4), 'interpretation': interp}
    return out


def batter_pressure_profile(df: pd.DataFrame) -> dict:
    """Batter vulnerability split by pressure tier + postseason."""
    df = add_leverage(df)
    out = {}
    for tier, (lo, hi) in PRESSURE_TIERS.items():
        mask = (df['leverage'] >= lo) & (df['leverage'] < hi)
        s = _tier_stats_batter(df[mask])
        if s: out[tier] = s
    for label, mask in [('Postseason', df['game_type'].isin(POSTSEASON)),
                        ('Regular',    df['game_type'] == 'R')]:
        s = _tier_stats_batter(df[mask])
        if s: out[label] = s
    if 'High' in out and 'Normal' in out:
        cd = out['High']['chase_rate'] - out['Normal']['chase_rate']
        wd = out['High']['whiff_rate'] - out['Normal']['whiff_rate']
        if   cd > 0.05 or wd > 0.03: interp = 'EXPLOITABLE — Batter chases/misses MORE under pressure'
        elif cd < -0.05 or wd < -0.03: interp = 'CLUTCH — Batter MORE disciplined under pressure'
        else:                          interp = 'CONSISTENT — Batter stable under pressure'
        out['clutch_delta'] = {'chase_delta': round(cd,4), 'whiff_delta': round(wd,4), 'interpretation': interp}
    return out


# ──────────────────────────────────────���──────────────────────────────────────
# PITCHER PROFILE
# ──────────────────────��──────────────────────────────────────────��───────────
class PitcherProfile:
    """Comprehensive pitcher profile: repertoire, count/zone/sequence tendencies,
    and pressure splits from 2024-2025 Statcast data."""

    def __init__(self, pitcher_id: int, name: str, data: pd.DataFrame):
        self.pitcher_id = pitcher_id
        self.name       = name
        self.data       = data
        df = data[data['pitch_type'].isin(PITCH_TYPES)].copy()
        self.handedness       = df['p_throws'].mode()[0] if 'p_throws' in df.columns else 'R'
        self.repertoire       = self._repertoire(df)
        self.count_tendencies = self._count_tend(df)
        self.zone_tendencies  = self._zone_tend(df)
        self.sequences        = self._sequences(df)
        self.pressure         = pitcher_pressure_profile(data)

    def _repertoire(self, df):
        rep, total = {}, len(df)
        for pt, g in df.groupby('pitch_type'):
            n      = len(g)
            sw     = g[g['description'].isin(SWING_DESC)]
            wh     = g[g['description'].isin(WHIFF_DESC)]
            iz     = g[g['zone'].between(1,9)]
            oz     = g[g['zone'].isin([11,12,13,14])]
            chase  = oz[oz['description'].isin(SWING_DESC)]
            cstr   = g[g['description'] == 'called_strike']
            rep[pt] = {
                'name':       PITCH_TYPES[pt],
                'usage_pct':  n / total * 100,
                'count':      n,
                'avg_velo':   float(g['release_speed'].mean()) if not g['release_speed'].isna().all() else None,
                'whiff_rate': len(wh) / len(sw) if len(sw) > 0 else 0,
                'zone_rate':  len(iz) / n,
                'chase_rate': len(chase) / len(oz) if len(oz) > 0 else 0,
                'csw_rate':   (len(cstr) + len(wh)) / n,
            }
        return rep

    def _count_tend(self, df):
        df = df[df['balls'].notna() & df['strikes'].notna()].copy()
        df['cnt'] = df['balls'].astype(int).astype(str) + '-' + df['strikes'].astype(int).astype(str)
        out = {}
        for cnt, g in df.groupby('cnt'):
            if len(g) < 5: continue
            out[cnt] = {'n': len(g), 'dist': g['pitch_type'].value_counts(normalize=True).to_dict(),
                        'top': g['pitch_type'].mode()[0]}
        return out

    def _zone_tend(self, df):
        out = {}
        for pt, g in df.groupby('pitch_type'):
            out[pt] = {'zone_dist': g['zone'].value_counts(normalize=True).to_dict()}
        return out

    def _sequences(self, df):
        """Markov transition P(next_pitch | prev_pitch) within same AB."""
        trans = defaultdict(lambda: defaultdict(int))
        df_s  = df.sort_values(['game_pk','at_bat_number','pitch_number'])
        prev_pt = prev_gm = prev_ab = None
        for _, row in df_s.iterrows():
            gm, ab, pt = row['game_pk'], row['at_bat_number'], row['pitch_type']
            if prev_pt and gm == prev_gm and ab == prev_ab:
                trans[prev_pt][pt] += 1
            prev_pt, prev_gm, prev_ab = pt, gm, ab
        probs = {}
        for prev, nexts in trans.items():
            total = sum(nexts.values())
            probs[prev] = {nxt: cnt/total for nxt,cnt in nexts.items()}
        return probs


# ─────────────────────────────────────────────────────────────────────────────
# BATTER PROFILE
# ─────────────────────────────────────────────────────────────────────────────
class BatterProfile:
    """Batter vulnerability profile: zone heat map, pitch-type weaknesses,
    count aggressiveness, and pressure splits."""

    def __init__(self, batter_id: int, name: str, data: pd.DataFrame):
        self.batter_id = batter_id
        self.name      = name
        self.data      = data
        df = data[data['pitch_type'].notna()].copy()
        self.stands     = df['stand'].mode()[0] if 'stand' in df.columns else 'R'
        self.zone_map   = self._zone_map(df)
        self.pt_map     = self._pt_map(df)
        self.count_map  = self._count_map(df)
        self.discipline = self._discipline(df)
        self.pressure   = batter_pressure_profile(data)

    def _zone_map(self, df):
        out = {}
        for zone in list(range(1,10)) + [11,12,13,14]:
            g = df[df['zone'] == zone]
            if len(g) < 3: continue
            n  = len(g)
            sw = g[g['description'].isin(SWING_DESC)]
            wh = g[g['description'].isin(WHIFF_DESC)]
            hi = g[g['description'].str.contains('hit_into_play', na=False)]
            hh = hi[hi['launch_speed'] >= 95] if 'launch_speed' in hi.columns else pd.DataFrame()
            out[int(zone)] = {
                'n':          n,
                'swing_rate': len(sw) / n,
                'whiff_rate': len(wh) / len(sw) if len(sw) > 0 else 0,
                'hard_hit':   len(hh) / len(hi) if len(hi) > 0 else 0,
                'pitchcom':   ZONE_TO_PITCHCOM.get(zone, {}).get('dir', 'Middle'),
            }
        return out

    def _pt_map(self, df):
        out = {}
        for pt, g in df.groupby('pitch_type'):
            if pt not in PITCH_TYPES or len(g) < 5: continue
            n  = len(g)
            sw = g[g['description'].isin(SWING_DESC)]
            wh = g[g['description'].isin(WHIFF_DESC)]
            oz = g[g['zone'].isin([11,12,13,14])]
            ch = oz[oz['description'].isin(SWING_DESC)]
            out[pt] = {
                'name':       PITCH_TYPES[pt],
                'n':          n,
                'swing_rate': len(sw) / n,
                'whiff_rate': len(wh) / len(sw) if len(sw) > 0 else 0,
                'chase_rate': len(ch) / len(oz) if len(oz) > 0 else 0,
            }
        return out

    def _count_map(self, df):
        df = df[df['balls'].notna() & df['strikes'].notna()].copy()
        df['cnt'] = df['balls'].astype(int).astype(str) + '-' + df['strikes'].astype(int).astype(str)
        out = {}
        for cnt, g in df.groupby('cnt'):
            if len(g) < 3: continue
            sw = g[g['description'].isin(SWING_DESC)]
            sr = len(sw) / len(g)
            out[cnt] = {'n': len(g), 'swing_rate': sr, 'aggressive': sr > 0.55}
        return out

    def _discipline(self, df):
        iz = df[df['zone'].between(1,9)]
        oz = df[df['zone'].isin([11,12,13,14])]
        zs = iz[iz['description'].isin(SWING_DESC)]
        cs = oz[oz['description'].isin(SWING_DESC)]
        al = df[df['description'].isin(SWING_DESC)]
        return {
            'z_swing':     len(zs) / len(iz) if len(iz) > 0 else 0,
            'chase_rate':  len(cs) / len(oz) if len(oz) > 0 else 0,
            'swing_rate':  len(al) / len(df) if len(df) > 0 else 0,
        }

    def vulnerabilities(self) -> List[dict]:
        """Rank all (pitch_type, zone) pairs by exploitation score."""
        vulns = []
        for zone, zs in self.zone_map.items():
            for pt, ps in self.pt_map.items():
                score = zs['whiff_rate']*0.4 + ps['whiff_rate']*0.4 + ps['chase_rate']*0.2
                vulns.append({
                    'pitch_type': pt, 'zone': zone,
                    'pitchcom': zs['pitchcom'],
                    'score': score,
                    'zone_whiff': zs['whiff_rate'],
                    'pt_whiff': ps['whiff_rate'],
                    'pt_chase': ps['chase_rate'],
                    'hard_hit_risk': zs.get('hard_hit', 0),
                })
        return sorted(vulns, key=lambda x: -x['score'])


# ─────────────────────────────────────────────────────────────────────────────
# RULE-BASED ENGINE
# ─────────────────────────────────────────────────────────────────────────────
class RuleEngine:
    """Score every (pitch_type, zone) candidate using baseball strategy rules."""

    PITCHER_COUNTS = {'0-1','0-2','1-2','2-2'}
    HITTER_COUNTS  = {'1-0','2-0','3-0','3-1'}

    SETUPS = {
        'FF': ['SL','ST','CH','CU'],
        'FT': ['SL','CH','ST'],
        'SI': ['SL','CH','ST'],
        'FC': ['CH','FF','CU'],
        'SL': ['FF','FT','CH'],
        'ST': ['FF','FT','CU'],
        'CU': ['FF','FC'],
        'CH': ['FF','FT','SL'],
    }

    def __init__(self, pitcher: PitcherProfile, batter: BatterProfile):
        self.pitcher = pitcher
        self.batter  = batter
        self._vulns  = {(v['pitch_type'], v['zone']): v
                        for v in batter.vulnerabilities()[:30]}

    def recommend(self, count: str, prev_pitches: List[dict],
                  leverage: float = 1.0) -> List[dict]:
        """Return top-10 ranked recommendations for the current pitch."""
        recs  = []
        last  = prev_pitches[-1] if prev_pitches else None

        for pt, ps in self.pitcher.repertoire.items():
            if ps['usage_pct'] < 2.0:
                continue
            zdist = self.pitcher.zone_tendencies.get(pt, {}).get('zone_dist', {})
            for zone in list(range(1,10)) + [11,12,13,14]:
                freq = zdist.get(float(zone), zdist.get(zone, 0))
                if freq < 0.02:
                    continue
                sc, reasons = self._score(pt, zone, count, last, prev_pitches, ps)
                recs.append({
                    'pitch_type':   pt,
                    'pitch_name':   PITCH_TYPES.get(pt, pt),
                    'zone':         zone,
                    'pitchcom_dir': ZONE_TO_PITCHCOM.get(zone,{}).get('dir','Middle'),
                    'pitchcom_seq': f"[{PITCH_TYPES.get(pt,'').upper()}] → [{ZONE_TO_PITCHCOM.get(zone,{}).get('dir','').upper()}]",
                    'pitchcom_desc':ZONE_TO_PITCHCOM.get(zone,{}).get('desc',''),
                    'score':        sc,
                    'reasons':      reasons,
                    'csw':          ps['csw_rate'],
                    'whiff':        ps['whiff_rate'],
                })

        recs.sort(key=lambda x: -x['score'])
        return self._pressure_adjust(recs, leverage)[:10]

    def _score(self, pt, zone, count, last, prev_pitches, ps):
        sc, reasons = 0.0, []
        sc += ps['whiff_rate'] * 30
        sc += ps['csw_rate']   * 20
        bz = self.batter.zone_map.get(zone, {})
        bp = self.batter.pt_map.get(pt, {})
        if bz:
            sc += bz.get('whiff_rate',0) * 25
            sc -= bz.get('hard_hit',0)   * 20
        if bp:
            sc += bp.get('whiff_rate',0) * 20
            if zone in [11,12,13,14]:
                sc += bp.get('chase_rate',0) * 15
        s, r = self._count_rules(pt, zone, count, ps)
        sc += s; reasons.extend(r)
        if last:
            s, r = self._seq_rules(pt, zone, last, prev_pitches)
            sc += s; reasons.extend(r)
        s, r = self._zone_rules(pt, zone, bz, bp)
        sc += s; reasons.extend(r)
        return sc, reasons

    def _count_rules(self, pt, zone, count, ps):
        sc, r = 0.0, []
        if count in self.PITCHER_COUNTS:
            if zone in [11,12,13,14]:
                sc += 15; r.append(f"Pitcher's count ({count}): expand zone, chase pitch")
            if ps['whiff_rate'] > 0.28:
                sc += 10; r.append(f"Best swing-miss pitch ({ps['whiff_rate']*100:.0f}% whiff) in pitcher's count")
            if count == '0-2' and zone in [11,12,13,14]:
                sc += 20; r.append('0-2: waste/chase strongly preferred')
            if count == '0-2' and zone == 5:
                sc -= 15; r.append('0-2: never gift middle of zone')
        elif count in self.HITTER_COUNTS:
            if 1 <= zone <= 9:
                sc += 20; r.append(f"Hitter's count ({count}): MUST throw strike")
            if pt in ('FF','FT','SI','FC'):
                sc += 10; r.append("Hitter's count: best fastball for strike")
            if zone in [11,12,13,14]:
                sc -= 15; r.append(f"Hitter's count ({count}): avoid walk")
        elif count == '0-0':
            if pt == 'FF' and zone in [1,2,3,4,6]:
                sc += 12; r.append('First pitch: establish fastball, get ahead')
            elif pt in ('SL','CU','ST','CH') and 1 <= zone <= 9:
                sc += 8; r.append('First pitch: early off-speed strike — surprise')
        elif count == '3-2':
            if 1 <= zone <= 9:
                sc += 15; r.append('Full count: need a strike')
            if ps['whiff_rate'] > 0.25:
                sc += 12; r.append('Full count: best strikeout pitch')
        return sc, r

    def _seq_rules(self, pt, zone, last, prev_pitches):
        sc, r = 0.0, []
        lt, lr, lz = last.get('type'), last.get('result',''), last.get('zone',5)
        if lt in self.SETUPS and pt in self.SETUPS[lt]:
            sc += 15; r.append(f'Classic sequence: {lt} → {pt}')
        if pt == lt and zone == lz:
            if lr in ('swinging_strike','called_strike','foul_tip'):
                sc += 8; r.append(f'Repeat {pt} — batter missed it, go back')
            elif lr in ('ball','hit_into_play'):
                sc -= 15; r.append(f'Avoid repeating {pt} to same zone (last: {lr})')
        if lz in [1,4,7] and zone in [3,6,9]:   sc += 8;  r.append('Tunnel: inside → away')
        if lz in [3,6,9] and zone in [1,4,7]:   sc += 8;  r.append('Tunnel: away → inside')
        if lz in [1,2,3] and zone in [7,8,9,11,12]: sc += 10; r.append('Eye level: high → low')
        if lz in [7,8,9] and zone in [1,2,3]:   sc += 10; r.append('Eye level: low → high')
        if lr in ('swinging_strike','swinging_strike_blocked') and lz == zone:
            sc += 12; r.append('Batter whiffed here — exploit again')
        if lr == 'ball' and pt == lt:
            sc -= 8; r.append('Batter laid off same pitch — change type')
        ct = sum(1 for p in prev_pitches if p.get('type') == pt)
        if ct >= 2:
            sc -= 10; r.append(f'{pt} thrown {ct}x this AB — batter may be timing it')
        seq = self.pitcher.sequences.get(lt, {})
        if seq.get(pt, 0) > 0.35:
            sc -= 5; r.append(f'Common {lt}→{pt} for {self.pitcher.name} — batter may expect it')
        elif seq.get(pt, 0) < 0.10 and lt is not None:
            sc += 5; r.append('Unexpected sequence — element of surprise')
        return sc, r

    def _zone_rules(self, pt, zone, bz, bp):
        sc, r = 0.0, []
        if zone in [6,9]:                    sc += 5;  r.append('Down-away: minimal hard-contact zone')
        if zone in [1,4] and pt in ('FF','FT','FC','SI'): sc += 8; r.append('Up-in FB: hard to extend, weak contact')
        if pt in ('SL','CU','KC','ST') and zone in [7,8,9,11,12]: sc += 7; r.append('Low breaking ball: GB / chase')
        if pt == 'CH' and zone in [6,9,14]:  sc += 10; r.append('Changeup low-away: classic out pitch')
        if bz.get('whiff_rate',0) > 0.28:
            sc += 15; r.append(f"Zone {zone} is batter's weak spot ({bz['whiff_rate']*100:.0f}% whiff)")
        if bz.get('hard_hit',0) > 0.25:
            sc -= 12; r.append(f"Zone {zone} is batter's power zone — avoid")
        return sc, r

    def _pressure_adjust(self, recs, lev):
        if lev < 1.0:
            return recs
        cd = self.batter.pressure.get('clutch_delta', {}).get('chase_delta', 0)
        for rec in recs:
            if lev >= 2.0 and rec['whiff'] > 0.28:
                rec['score'] *= 1.15
                rec['reasons'].append(f'HIGH LEVERAGE ({lev:.1f}): prioritise swing-miss pitch')
            if lev >= 1.5 and cd > 0.05 and rec['zone'] in [11,12,13,14]:
                rec['score'] += 12
                rec['reasons'].append(f'PRESSURE: batter chases {cd*100:.0f}% more — use it')
            elif lev >= 1.5 and cd < -0.05 and rec['zone'] in [11,12,13,14]:
                rec['score'] -= 8
                rec['reasons'].append('PRESSURE: batter is disciplined — avoid waste')
            if lev > 2.5 and rec['zone'] in [11,12,13,14]:
                rec['score'] *= 0.85
                rec['reasons'].append('Extreme pressure: reduce chase (no walks)')
        recs.sort(key=lambda x: -x['score'])
        return recs


# ─────────────────────────────────────────────────────────────────────────────
# ML MODEL — HistGradientBoostingClassifier
# ─────────────────────────────────────────────────────────────────────────────
class PitchOutcomeModel:

    def __init__(self, cache_dir: Optional[str] = None):
        self.model       = None
        self.feat_cols   = []
        self.is_trained  = False
        self.class_names = ['whiff', 'called_strike', 'foul', 'ball', 'in_play']
        self.cache_dir   = cache_dir

    @staticmethod
    def _cache_key(pitcher_id: int, data_hash: str) -> str:
        return f"pitch_model_{pitcher_id}_{data_hash}.joblib"

    @staticmethod
    def _data_hash(df: pd.DataFrame) -> str:
        sig = f"{sorted(df.index.tolist())}_{df.shape}_{df.dtypes.to_dict()}"
        return hashlib.md5(sig.encode()).hexdigest()[:12]

    def save(self, pitcher_id: int, data_hash: str):
        if self.cache_dir is None:
            return
        os.makedirs(self.cache_dir, exist_ok=True)
        path = os.path.join(self.cache_dir, self._cache_key(pitcher_id, data_hash))
        joblib.dump({
            'model':       self.model,
            'feat_cols':   self.feat_cols,
            'class_names': getattr(self, 'class_names', []),
        }, path)
        print(f'  ML model saved to {path}')

    @classmethod
    def load(cls, cache_dir: str, pitcher_id: int, data_hash: str) -> Optional['PitchOutcomeModel']:
        path = os.path.join(cache_dir, cls._cache_key(pitcher_id, data_hash))
        try:
            blob = joblib.load(path)
            obj = cls(cache_dir=cache_dir)
            obj.model       = blob['model']
            obj.feat_cols   = blob['feat_cols']
            obj.class_names = blob.get('class_names', ['whiff','called_strike','foul','ball','in_play'])
            obj.is_trained  = True
            return obj
        except Exception:
            return None

    @staticmethod
    def _col(df: pd.DataFrame, col: str, default=0) -> pd.Series:
        if col in df.columns:
            return df[col]
        return pd.Series([default] * len(df), index=df.index)

    def _featurize(self, df: pd.DataFrame) -> pd.DataFrame:
        c = self._col
        d = pd.DataFrame(index=df.index)

        d['balls']          = pd.to_numeric(c(df,'balls',0),          errors='coerce').fillna(0)
        d['strikes']        = pd.to_numeric(c(df,'strikes',0),        errors='coerce').fillna(0)
        d['count_state']    = d['balls'] * 4 + d['strikes']
        d['pitchers_count'] = (d['strikes'] >= 2).astype(int)
        d['hitters_count']  = ((d['balls'] >= 2) & (d['strikes'] <= 1)).astype(int)
        d['outs']           = pd.to_numeric(c(df,'outs_when_up',0),   errors='coerce').fillna(0)
        d['inning']         = pd.to_numeric(c(df,'inning',1),         errors='coerce').fillna(1)
        d['late_inning']    = (d['inning'] >= 7).astype(int)
        d['on_1b']          = c(df,'on_1b', None).notna().astype(int)
        d['on_2b']          = c(df,'on_2b', None).notna().astype(int)
        d['on_3b']          = c(df,'on_3b', None).notna().astype(int)
        d['runners']        = d['on_1b'] + d['on_2b'] + d['on_3b']
        d['scoring_pos']    = ((d['on_2b'] + d['on_3b']) > 0).astype(int)
        hs                  = pd.to_numeric(c(df,'home_score',0),     errors='coerce').fillna(0)
        as_                 = pd.to_numeric(c(df,'away_score',0),     errors='coerce').fillna(0)
        d['score_diff']     = hs - as_
        d['close_game']     = (d['score_diff'].abs() <= 2).astype(int)
        d['release_speed']  = pd.to_numeric(c(df,'release_speed',92), errors='coerce').fillna(92)
        d['pfx_x']          = pd.to_numeric(c(df,'pfx_x',0),          errors='coerce').fillna(0)
        d['pfx_z']          = pd.to_numeric(c(df,'pfx_z',0),          errors='coerce').fillna(0)
        pt_col              = c(df,'pitch_type','')
        for pt in ['FF','FT','SI','FC','SL','ST','CU','CH']:
            d[f'is_{pt}']   = (pt_col == pt).astype(int)
        d['zone']           = pd.to_numeric(c(df,'zone',5),           errors='coerce').fillna(5)
        d['in_zone']        = d['zone'].between(1, 9).astype(int)
        d['zone_row']       = d['zone'].apply(lambda z: 0 if z in [1,2,3] else 1 if z in [4,5,6] else 2)
        d['zone_col']       = d['zone'].apply(lambda z: int(z) % 3)
        d['chase_zone']     = d['zone'].isin([11,12,13,14]).astype(int)
        d['leverage']       = df.apply(compute_leverage, axis=1)
        d['postseason']     = c(df,'game_type','R').isin(POSTSEASON).astype(int)

        # ── Group A: Pitch movement & release ────────────────────────────────
        d['release_pos_x']   = pd.to_numeric(c(df,'release_pos_x',0),    errors='coerce').fillna(0)
        d['release_pos_z']   = pd.to_numeric(c(df,'release_pos_z',6),    errors='coerce').fillna(6)
        d['effective_speed'] = pd.to_numeric(c(df,'effective_speed',92), errors='coerce').fillna(92)
        d['spin_axis']       = pd.to_numeric(c(df,'spin_axis',180),      errors='coerce').fillna(180)
        d['plate_x']         = pd.to_numeric(c(df,'plate_x',0),          errors='coerce').fillna(0)
        d['plate_z']         = pd.to_numeric(c(df,'plate_z',2.5),        errors='coerce').fillna(2.5)
        _tmp_spd  = pd.DataFrame({'spd': d['release_speed'], 'pt': pt_col})
        _mean_spd = _tmp_spd.groupby('pt')['spd'].transform('mean')
        d['velo_diff_from_avg'] = (d['release_speed'] - _mean_spd).fillna(0)

        # ── Group B: Platoon matchup ──────────────────────────────────────────
        p_throws = c(df,'p_throws','R')
        stand    = c(df,'stand','R')
        d['pitcher_R'] = (p_throws == 'R').astype(int)
        d['batter_R']  = (stand == 'R').astype(int)
        d['same_hand'] = (p_throws == stand).astype(int)

        # ── Group C: Sequencing features ─────────────────────────────────────
        if 'prev_pitch_type' in df.columns:
            # Inference path: ctx already contains prev values as columns
            prev_pt   = c(df,'prev_pitch_type','')
            prev_zone = pd.to_numeric(c(df,'prev_zone',0),          errors='coerce').fillna(0)
            prev_desc = c(df,'prev_description','')
            prev_spd  = pd.to_numeric(c(df,'prev_release_speed',0), errors='coerce').fillna(0)
            pitch_num = pd.to_numeric(c(df,'pitch_number',1),       errors='coerce').fillna(1)
        elif all(col in df.columns for col in ['game_pk','at_bat_number','pitch_number']):
            # Training path: derive from within-at-bat ordering
            _s = df.sort_values(['game_pk','at_bat_number','pitch_number'])
            _g = _s.groupby(['game_pk','at_bat_number'])
            prev_pt   = _g['pitch_type'].shift(1).reindex(df.index).fillna('')
            prev_zone = pd.to_numeric(
                _g['zone'].shift(1).reindex(df.index),          errors='coerce').fillna(0)
            prev_desc = _g['description'].shift(1).reindex(df.index).fillna('')
            prev_spd  = pd.to_numeric(
                _g['release_speed'].shift(1).reindex(df.index), errors='coerce').fillna(0)
            pitch_num = pd.to_numeric(c(df,'pitch_number',1), errors='coerce').fillna(1)
        else:
            prev_pt   = pd.Series('',  index=df.index)
            prev_zone = pd.Series(0.0, index=df.index)
            prev_desc = pd.Series('',  index=df.index)
            prev_spd  = pd.Series(0.0, index=df.index)
            pitch_num = pd.Series(1.0, index=df.index)

        for pt in ['FF','FT','SI','FC','SL','ST','CU','CH']:
            d[f'prev_{pt}']      = (prev_pt == pt).astype(int)
        d['prev_zone']           = prev_zone
        d['prev_in_zone']        = prev_zone.between(1, 9).astype(int)
        _strike_desc = {'called_strike','swinging_strike','swinging_strike_blocked','foul','foul_tip'}
        _ball_desc   = {'ball','blocked_ball'}
        _whiff_desc  = {'swinging_strike','swinging_strike_blocked'}
        d['prev_was_strike']     = prev_desc.isin(_strike_desc).astype(int)
        d['prev_was_ball']       = prev_desc.isin(_ball_desc).astype(int)
        d['prev_was_whiff']      = prev_desc.isin(_whiff_desc).astype(int)
        d['velo_change']         = (d['release_speed'] - prev_spd).where(prev_spd > 0, 0).fillna(0)
        d['same_as_prev']        = (pt_col == prev_pt).astype(int)
        d['pitch_num_in_ab']     = pitch_num

        return d.fillna(0)

    def _target(self, df: pd.DataFrame) -> pd.Series:
        desc = df['description']
        cat = pd.Series(index=df.index, dtype='Int64')
        cat[desc.isin({'swinging_strike', 'swinging_strike_blocked'})] = 0
        cat[desc == 'called_strike']                                    = 1
        cat[desc.isin({'foul', 'foul_tip'})]                           = 2
        cat[desc.isin({'ball', 'blocked_ball'})]                       = 3
        cat[desc.str.contains('hit_into_play', na=False)]              = 4
        return cat.dropna().astype(int)

    def train(self, pitcher_data: pd.DataFrame, pitcher_id: int = 0):
        df = pitcher_data[pitcher_data['pitch_type'].notna()].copy()
        print(f'  Building features for {len(df):,} pitches...')
        X = self._featurize(df)
        y = self._target(df.loc[X.index])
        X = X.loc[y.index]
        print(f'  Class distribution: { {k: int((y==v).sum()) for k,v in zip(self.class_names, range(5))} }')
        try:
            X_tr, X_te, y_tr, y_te = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y)
        except ValueError:
            X_tr, X_te, y_tr, y_te = train_test_split(
                X, y, test_size=0.2, random_state=42)
        self.model = HistGradientBoostingClassifier(
            max_iter=300, max_depth=6, learning_rate=0.05,
            min_samples_leaf=20, random_state=42)
        self.model.fit(X_tr, y_tr)
        calibrated = CalibratedClassifierCV(
            estimator=self.model, method='isotonic', cv='prefit')
        calibrated.fit(X_te, y_te)
        self.model = calibrated
        acc = accuracy_score(y_te, self.model.predict(X_te))
        print(f'  Test accuracy: {acc:.3f}')
        cal_probs = self.model.predict_proba(X_te)
        n_classes = cal_probs.shape[1]
        brier_scores = []
        for k in range(n_classes):
            bs = brier_score_loss((y_te == k).astype(int), cal_probs[:, k])
            brier_scores.append(bs)
        print(f'  Mean Brier score: {np.mean(brier_scores):.4f}  (per-class: {", ".join(f"{self.class_names[k]}={b:.4f}" for k, b in enumerate(brier_scores))})')
        print(classification_report(y_te, self.model.predict(X_te),
                                    target_names=self.class_names, zero_division=0))
        self.feat_cols  = list(X.columns)
        self.is_trained = True
        self.save(pitcher_id, self._data_hash(pitcher_data))
        return self

    def score_candidates(self, candidates: List[dict], ctx: dict) -> List[dict]:
        if not self.is_trained:
            return candidates
        rows  = [{**ctx, 'pitch_type': c['pitch_type'], 'zone': c['zone']}
                 for c in candidates]
        X     = self._featurize(pd.DataFrame(rows))[self.feat_cols].fillna(0)
        probs = self.model.predict_proba(X)           # shape (n, 5)
        for i, c in enumerate(candidates):
            c['ml_whiff_prob']     = float(probs[i, 0])
            c['ml_strike_prob']    = float(probs[i, 1])
            c['ml_foul_prob']      = float(probs[i, 2])
            c['ml_ball_prob']      = float(probs[i, 3])
            c['ml_inplay_prob']    = float(probs[i, 4])
            c['ml_favorable_prob'] = float(probs[i, 0] + probs[i, 1])
            c['ml_prob']           = c['ml_favorable_prob']  # backward compat
        return candidates


# ─────────────────────────────────────────────────────────────────────────────
# REAL-TIME AT-BAT TRACKER
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class PitchRecord:
    num:       int
    pt:        str
    name:      str
    zone:      int
    loc:       str
    result:    str
    events:    str   = ''
    velocity:  float = 0.0


class AtBatTracker:
    """Maintains count, pitch history, momentum, and real-time batter patterns."""

    def __init__(self, pitcher: str, batter: str, game_state: dict):
        self.pitcher    = pitcher
        self.batter     = batter
        self.gs         = game_state
        self.balls      = 0
        self.strikes    = 0
        self.history: List[PitchRecord] = []
        self.complete   = False
        self.result     = None
        self.momentum   = 1.0
        self._pt_results = defaultdict(list)

    @property
    def count(self): return f'{self.balls}-{self.strikes}'

    @property
    def pitch_num(self): return len(self.history) + 1

    @property
    def leverage(self):
        return compute_leverage({**self.gs, 'outs_when_up': self.gs.get('outs',0)})

    def record(self, pr: PitchRecord):
        self.history.append(pr)
        self._pt_results[pr.pt].append(pr.result)
        r = pr.result
        if r in ('swinging_strike','swinging_strike_blocked','called_strike'):
            if self.strikes < 2: self.strikes += 1
            else:
                if pr.events == 'strikeout' or r not in ('foul',):
                    self.complete = True; self.result = 'strikeout'; return
        elif r == 'foul_tip':
            if self.strikes < 2: self.strikes += 1
            else: self.complete = True; self.result = 'strikeout'; return
        elif r == 'foul':
            if self.strikes < 2: self.strikes += 1
        elif r == 'ball':
            self.balls += 1
            if self.balls == 4: self.complete = True; self.result = 'walk'; return
        elif r == 'hit_into_play':
            self.complete = True; self.result = pr.events or 'in_play'; return
        if pr.events == 'strikeout':
            self.complete = True; self.result = 'strikeout'; return
        if r in ('swinging_strike','called_strike'): self.momentum = min(self.momentum*1.12, 1.6)
        elif r in ('ball','hit_into_play'):          self.momentum = max(self.momentum*0.88, 0.6)

    def rt_adjustments(self) -> dict:
        """Detect in-AB patterns: is batter struggling or laying off a pitch?"""
        adj = {}
        for pt, results in self._pt_results.items():
            if len(results) < 2: continue
            wh = sum(1 for r in results if 'swinging_strike' in r)
            tk = sum(1 for r in results if r in ('ball','called_strike'))
            if wh/len(results) >= 0.5:
                adj[pt] = {'boost': +12, 'note': f'[REAL-TIME] Batter whiffing on {pt} this AB ({wh}/{len(results)}) — keep going back'}
            elif tk/len(results) >= 0.6:
                adj[pt] = {'boost': -6,  'note': f'[REAL-TIME] Batter laying off {pt} this AB — adjust'}
        return adj

    def prev_dict(self) -> List[dict]:
        return [{'type': p.pt, 'zone': p.zone, 'result': p.result} for p in self.history]

    def to_dict(self) -> dict:
        """Serialize tracker state for API responses."""
        lev = self.leverage
        tier = ('Extreme' if lev > 2.5 else 'High' if lev > 1.5
                else 'Normal' if lev > 0.85 else 'Low')
        return {
            'pitcher':       self.pitcher,
            'batter':        self.batter,
            'balls':         self.balls,
            'strikes':       self.strikes,
            'count':         self.count,
            'pitch_num':     self.pitch_num,
            'leverage':      lev,
            'leverage_tier': tier,
            'momentum':      round(self.momentum, 3),
            'complete':      self.complete,
            'ab_result':     self.result,
            'history': [
                {
                    'num':      p.num,
                    'pt':       p.pt,
                    'name':     p.name,
                    'zone':     p.zone,
                    'loc':      p.loc,
                    'result':   p.result,
                    'events':   p.events,
                    'velocity': p.velocity,
                }
                for p in self.history
            ],
        }


# ─────────────────────────────────────────────────────────────────────────────
# PERFECT PITCH AI — MAIN ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────
class PerfectPitchAI:

    def __init__(self, cache_dir='./perfect_pitch_cache'):
        self.fetcher  = StatcastDataFetcher(cache_dir)
        self.pitcher: Optional[PitcherProfile] = None
        self.batter:  Optional[BatterProfile]  = None
        self.rules:   Optional[RuleEngine]     = None
        self.ml       = PitchOutcomeModel()
        self.ab:      Optional[AtBatTracker]   = None
        self._pdata   = None

    def load_matchup(self, pitcher_name: str, batter_name: str,
                     pitcher_id: int = None, batter_id: int = None):
        if pitcher_id is None:
            pitcher_id = KNOWN_PLAYERS.get(pitcher_name)
            if not pitcher_id:
                raise ValueError(f'Unknown pitcher: {pitcher_name}. Pass pitcher_id=<MLB_ID>')
        if batter_id is None:
            batter_id = KNOWN_PLAYERS.get(batter_name)
            if not batter_id:
                raise ValueError(f'Unknown batter: {batter_name}. Pass batter_id=<MLB_ID>')

        print(f'Loading: {pitcher_name} vs {batter_name}')
        self._pdata  = self.fetcher.get_pitcher_data(pitcher_id, pitcher_name)
        self.pitcher = PitcherProfile(pitcher_id, pitcher_name, self._pdata)

        bdata        = self.fetcher.get_batter_data(batter_id, batter_name)
        self.batter  = BatterProfile(batter_id, batter_name, bdata)

        data_hash = PitchOutcomeModel._data_hash(self._pdata)
        cached = PitchOutcomeModel.load(self.fetcher.cache_dir, pitcher_id, data_hash)
        if cached:
            self.ml = cached
            print('  ML model loaded from cache')
        else:
            try:
                self.ml = PitchOutcomeModel(cache_dir=self.fetcher.cache_dir)
                self.ml.train(self._pdata, pitcher_id=pitcher_id)
            except Exception as e:
                print(f'ML training failed: {e} — rule-based only')

        self.rules = RuleEngine(self.pitcher, self.batter)
        print(f'Ready: {pitcher_name} vs {batter_name}')

    def start_at_bat(self, inning=1, outs=0, on_base='___',
                     home_score=0, away_score=0, game_type='R'):
        gs = {'inning': inning, 'outs': outs,
              'on_1b': 1 if '1' in on_base else None,
              'on_2b': 2 if '2' in on_base else None,
              'on_3b': 3 if '3' in on_base else None,
              'home_score': home_score, 'away_score': away_score,
              'game_type': game_type}
        self.ab = AtBatTracker(self.pitcher.name, self.batter.name, gs)

    def get_recommendation(self, top_n=3) -> List[dict]:
        if self.ab is None:
            raise RuntimeError('Call start_at_bat() first.')
        if self.ab.complete:
            return []

        lev  = self.ab.leverage
        prev = self.ab.prev_dict()

        recs = self.rules.recommend(self.ab.count, prev, lev)

        rt = self.ab.rt_adjustments()
        for rec in recs:
            if rec['pitch_type'] in rt:
                rec['score'] += rt[rec['pitch_type']]['boost']
                rec['reasons'].append(rt[rec['pitch_type']]['note'])

        _last = self.ab.history[-1] if self.ab.history else None
        ctx = {'balls': self.ab.balls, 'strikes': self.ab.strikes,
               'outs_when_up': self.ab.gs.get('outs',0),
               'inning': self.ab.gs.get('inning',1),
               'on_1b': self.ab.gs.get('on_1b'), 'on_2b': self.ab.gs.get('on_2b'),
               'on_3b': self.ab.gs.get('on_3b'),
               'home_score': self.ab.gs.get('home_score',0),
               'away_score': self.ab.gs.get('away_score',0),
               'game_type': self.ab.gs.get('game_type','R'),
               'release_speed': 93,
               'p_throws': self.pitcher.handedness,
               'stand':    self.batter.stands,
               'prev_pitch_type':    _last.pt       if _last else '',
               'prev_zone':          _last.zone     if _last else 0,
               'prev_description':   _last.result   if _last else '',
               'prev_release_speed': _last.velocity if _last else 0,
               'pitch_number':       self.ab.pitch_num}
        recs = self.ml.score_candidates(recs, ctx)
        for rec in recs:
            if 'ml_whiff_prob' in rec:
                rec['score'] += rec['ml_whiff_prob']  * 25
                rec['score'] += rec['ml_strike_prob'] * 15
                rec['score'] -= rec['ml_ball_prob']   * 10
                rec['score'] -= rec['ml_inplay_prob'] *  5
                whiff_pct  = rec['ml_whiff_prob']  * 100
                strike_pct = rec['ml_strike_prob'] * 100
                if whiff_pct + strike_pct > 30:
                    rec['reasons'].append(
                        f"[ML] {whiff_pct:.0f}% whiff / {strike_pct:.0f}% called-strike probability"
                    )
        recs.sort(key=lambda x: -x['score'])

        return recs[:top_n]

    def record_result(self, pitch_type: str, zone: int, result: str,
                      events: str = '', velocity: float = 0.0):
        if self.ab is None or self.ab.complete:
            return
        pr = PitchRecord(
            num=self.ab.pitch_num,
            pt=pitch_type,
            name=PITCH_TYPES.get(pitch_type, pitch_type),
            zone=zone,
            loc=ZONE_TO_PITCHCOM.get(zone, {}).get('dir', 'Middle'),
            result=result, events=events, velocity=velocity)
        self.ab.record(pr)
