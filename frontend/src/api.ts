import type { MatchupStatus, RecommendResponse, AtBatState, Player, KnownPlayersResponse, GameContextForm } from './types'

const BASE = '/api'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  searchPlayers: (q: string): Promise<Player[]> =>
    req(`/players/search?q=${encodeURIComponent(q)}`),

  knownPlayers: (): Promise<KnownPlayersResponse> =>
    req('/players/known'),

  loadMatchup: (pitcher_name: string, batter_name: string, pitcher_id?: number, batter_id?: number) =>
    req('/matchup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitcher_name, batter_name, pitcher_id, batter_id }),
    }),

  matchupStatus: (): Promise<MatchupStatus> =>
    req('/matchup/status'),

  startAtBat: (form: GameContextForm): Promise<AtBatState> => {
    const on_base =
      (form.on_1b ? '1' : '_') +
      (form.on_2b ? '2' : '_') +
      (form.on_3b ? '3' : '_')
    return req('/atbat/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inning: form.inning,
        outs: form.outs,
        on_base,
        home_score: form.home_score,
        away_score: form.away_score,
        game_type: form.game_type,
      }),
    })
  },

  atBatStatus: (): Promise<AtBatState> =>
    req('/atbat/status'),

  recommend: (top_n = 3): Promise<RecommendResponse> =>
    req(`/recommend?top_n=${top_n}`),

  record: (
    pitch_type: string,
    zone: number,
    result: string,
    events = '',
    velocity = 0,
  ): Promise<AtBatState> =>
    req('/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitch_type, zone, result, events, velocity }),
    }),

  resetAtBat: (): Promise<{ status: string }> =>
    req('/atbat/reset', { method: 'POST' }),
}
