export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Player {
  name: string
  id: number
  throws?: string   // 'R' | 'L' | ''
  bats?: string     // 'R' | 'L' | 'S' | ''
  team?: string     // team abbreviation e.g. 'NYY'
  position?: string // 'P', '1B', 'C', 'DH', etc.
}

export interface KnownPlayersResponse {
  pitchers: Player[]
  batters: Player[]
}

export interface ZoneData {
  swing_rate: number
  whiff_rate: number
  hard_hit: number
  pitchcom: string
}

export interface PitchTypeData {
  name: string
  swing_rate: number
  whiff_rate: number
  chase_rate: number
}

export interface RepertoireEntry {
  name: string
  usage_pct: number
  avg_velo: number | null
  whiff_rate: number
  csw_rate: number
}

export interface MatchupStatus {
  status: LoadStatus
  pitcher_name: string | null
  batter_name: string | null
  error: string | null
  pitcher?: {
    name: string
    handedness: string
    repertoire: Record<string, RepertoireEntry>
  }
  batter?: {
    name: string
    stands: string
    discipline: { z_swing: number; chase_rate: number; swing_rate: number }
    zone_map: Record<string, ZoneData>
    pt_map: Record<string, PitchTypeData>
    pressure: Record<string, unknown>
  }
}

export interface Recommendation {
  rank: number
  pitch_type: string
  pitch_name: string
  zone: number
  pitchcom_dir: string
  pitchcom_desc: string
  score: number
  ml_prob: number
  csw: number
  whiff: number
  reasons: string[]
}

export interface RecommendResponse {
  complete: boolean
  ab_result?: string
  count?: string
  pitch_num?: number
  leverage?: number
  recommendations: Recommendation[]
}

export interface PitchHistoryEntry {
  num: number
  pt: string
  name: string
  zone: number
  loc: string
  result: string
  events: string
  velocity: number
}

export interface AtBatState {
  pitcher: string
  batter: string
  balls: number
  strikes: number
  count: string
  pitch_num: number
  leverage: number
  leverage_tier: string
  momentum: number
  complete: boolean
  ab_result: string | null
  history: PitchHistoryEntry[]
}

export interface GameContextForm {
  inning: number
  outs: number
  on_1b: boolean
  on_2b: boolean
  on_3b: boolean
  home_score: number
  away_score: number
  game_type: string
}
