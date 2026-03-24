"""
Perfect Pitch AI — FastAPI Backend
"""

import threading
import os
import sys
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Resolve cache path relative to this file
CACHE_DIR = os.path.join(os.path.dirname(__file__), '..', 'perfect_pitch_cache')

sys.path.insert(0, os.path.dirname(__file__))
from perfect_pitch_core import (
    PerfectPitchAI, PITCH_TYPES, ZONE_TO_PITCHCOM,
    KNOWN_PLAYERS, KNOWN_PITCHERS, KNOWN_BATTERS,
    search_players, lookup_player, compute_leverage,
)

app = FastAPI(title='Perfect Pitch AI')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

# ─────────────────────────────────────────────────────────────────────────────
# Global session state (single-user)
# ─────────────────────────────────────────────────────────────────────────────
class _State:
    status: str = 'idle'      # idle | loading | ready | error
    error: Optional[str] = None
    ai: Optional[PerfectPitchAI] = None
    pitcher_name: Optional[str] = None
    batter_name: Optional[str] = None
    _lock = threading.Lock()

state = _State()


def _do_load(pitcher_name: str, batter_name: str,
             pitcher_id: Optional[int], batter_id: Optional[int]):
    try:
        ai = PerfectPitchAI(cache_dir=CACHE_DIR)
        ai.load_matchup(pitcher_name, batter_name, pitcher_id, batter_id)
        with state._lock:
            state.ai           = ai
            state.pitcher_name = pitcher_name
            state.batter_name  = batter_name
            state.status       = 'ready'
            state.error        = None
    except Exception as exc:
        with state._lock:
            state.status = 'error'
            state.error  = str(exc)


def _require_ready():
    if state.status != 'ready' or state.ai is None:
        raise HTTPException(status_code=400, detail='No matchup loaded. POST /api/matchup first.')


def _require_ab():
    _require_ready()
    if state.ai.ab is None:
        raise HTTPException(status_code=400, detail='No at-bat started. POST /api/atbat/start first.')


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────
class MatchupRequest(BaseModel):
    pitcher_name: str
    batter_name: str
    pitcher_id: Optional[int] = None
    batter_id: Optional[int] = None


class AtBatStartRequest(BaseModel):
    inning: int = 1
    outs: int = 0
    on_base: str = '___'       # e.g. '_2_' = runner on 2nd
    home_score: int = 0
    away_score: int = 0
    game_type: str = 'R'       # R | D | L | W


class RecordRequest(BaseModel):
    pitch_type: str
    zone: int
    result: str                # swinging_strike | called_strike | ball | foul | foul_tip | hit_into_play
    events: str = ''           # strikeout | single | double | home_run | field_out | ...
    velocity: float = 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get('/api/health')
def health():
    return {'ok': True}


@app.get('/api/players/search')
def players_search(q: str = ''):
    return search_players(q)


@app.get('/api/players/known')
def players_known():
    return {
        'pitchers': [{'name': n, 'id': i} for n, i in KNOWN_PITCHERS.items()],
        'batters':  [{'name': n, 'id': i} for n, i in KNOWN_BATTERS.items()],
    }


@app.post('/api/matchup')
def load_matchup(req: MatchupRequest):
    with state._lock:
        if state.status == 'loading':
            raise HTTPException(status_code=409, detail='Already loading a matchup.')
        state.status       = 'loading'
        state.error        = None
        state.pitcher_name = req.pitcher_name
        state.batter_name  = req.batter_name

    t = threading.Thread(
        target=_do_load,
        args=(req.pitcher_name, req.batter_name, req.pitcher_id, req.batter_id),
        daemon=True,
    )
    t.start()
    return {'status': 'loading', 'pitcher': req.pitcher_name, 'batter': req.batter_name}


@app.get('/api/matchup/status')
def matchup_status():
    resp = {
        'status':       state.status,
        'pitcher_name': state.pitcher_name,
        'batter_name':  state.batter_name,
        'error':        state.error,
    }
    if state.status == 'ready' and state.ai:
        ai = state.ai
        resp['pitcher'] = {
            'name':       ai.pitcher.name,
            'handedness': ai.pitcher.handedness,
            'repertoire': {
                pt: {
                    'name':      s['name'],
                    'usage_pct': round(s['usage_pct'], 1),
                    'avg_velo':  round(s['avg_velo'], 1) if s['avg_velo'] else None,
                    'whiff_rate': round(s['whiff_rate'], 3),
                    'csw_rate':  round(s['csw_rate'], 3),
                }
                for pt, s in ai.pitcher.repertoire.items()
            },
        }
        resp['batter'] = {
            'name':      ai.batter.name,
            'stands':    ai.batter.stands,
            'discipline': {k: round(v, 3) for k, v in ai.batter.discipline.items()},
            'zone_map':  {
                str(z): {
                    'swing_rate': round(d['swing_rate'], 3),
                    'whiff_rate': round(d['whiff_rate'], 3),
                    'hard_hit':  round(d['hard_hit'], 3),
                    'pitchcom':  d['pitchcom'],
                }
                for z, d in ai.batter.zone_map.items()
            },
            'pt_map': {
                pt: {
                    'name':       d['name'],
                    'swing_rate': round(d['swing_rate'], 3),
                    'whiff_rate': round(d['whiff_rate'], 3),
                    'chase_rate': round(d['chase_rate'], 3),
                }
                for pt, d in ai.batter.pt_map.items()
            },
            'pressure': {
                tier: {k: round(v, 3) if isinstance(v, float) else v
                       for k, v in vals.items()}
                for tier, vals in ai.batter.pressure.items()
            },
        }
    return resp


@app.post('/api/atbat/start')
def start_at_bat(req: AtBatStartRequest):
    _require_ready()
    state.ai.start_at_bat(
        inning=req.inning,
        outs=req.outs,
        on_base=req.on_base,
        home_score=req.home_score,
        away_score=req.away_score,
        game_type=req.game_type,
    )
    return state.ai.ab.to_dict()


@app.get('/api/atbat/status')
def atbat_status():
    _require_ab()
    return state.ai.ab.to_dict()


@app.get('/api/recommend')
def get_recommendation(top_n: int = 3):
    _require_ab()
    if state.ai.ab.complete:
        return {'complete': True, 'ab_result': state.ai.ab.result, 'recommendations': []}

    recs = state.ai.get_recommendation(top_n=top_n)
    return {
        'complete':        False,
        'count':           state.ai.ab.count,
        'pitch_num':       state.ai.ab.pitch_num,
        'leverage':        state.ai.ab.leverage,
        'recommendations': [
            {
                'rank':         i + 1,
                'pitch_type':   r['pitch_type'],
                'pitch_name':   r['pitch_name'],
                'zone':         r['zone'],
                'pitchcom_dir': r['pitchcom_dir'],
                'pitchcom_desc':r['pitchcom_desc'],
                'score':        round(r['score'], 1),
                'ml_prob':      round(r.get('ml_prob', 0), 3),
                'csw':          round(r['csw'], 3),
                'whiff':        round(r['whiff'], 3),
                'reasons':      r['reasons'][:6],
            }
            for i, r in enumerate(recs)
        ],
    }


@app.post('/api/record')
def record_result(req: RecordRequest):
    _require_ab()
    if state.ai.ab.complete:
        raise HTTPException(status_code=400, detail='At-bat is already complete.')
    state.ai.record_result(
        pitch_type=req.pitch_type.upper(),
        zone=req.zone,
        result=req.result,
        events=req.events,
        velocity=req.velocity,
    )
    return state.ai.ab.to_dict()


@app.post('/api/atbat/reset')
def reset_at_bat():
    """Clear the current at-bat so a new one can be started (same matchup)."""
    _require_ready()
    state.ai.ab = None
    return {'status': 'reset'}


@app.get('/api/constants')
def constants():
    return {
        'pitch_types':      PITCH_TYPES,
        'zone_to_pitchcom': {str(k): v for k, v in ZONE_TO_PITCHCOM.items()},
        'game_types': {
            'R': 'Regular Season',
            'D': 'Division Series',
            'L': 'Championship Series',
            'W': 'World Series',
        },
        'results': [
            'swinging_strike',
            'called_strike',
            'ball',
            'foul',
            'foul_tip',
            'hit_into_play',
        ],
        'events': [
            'strikeout',
            'single',
            'double',
            'triple',
            'home_run',
            'field_out',
            'grounded_into_double_play',
            'walk',
            'hit_by_pitch',
        ],
    }
