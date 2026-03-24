import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api'
import type {
  LoadStatus, MatchupStatus, AtBatState, RecommendResponse,
  GameContextForm, ZoneData, Player,
} from './types'
import { MatchupSetup } from './components/MatchupSetup'
import { headshotUrl } from './components/PlayerSearch'
import { GameContext } from './components/GameContext'
import { StrikeZone } from './components/StrikeZone'
import { RecommendationPanel } from './components/RecommendationPanel'
import { ResultInput } from './components/ResultInput'
import { PitchTimeline } from './components/PitchTimeline'

type View = 'setup' | 'context' | 'atbat'

export default function App() {
  const [view, setView]               = useState<View>('setup')
  const [loadStatus, setStatus]       = useState<LoadStatus>('idle')
  const [loadError, setError]         = useState<string | null>(null)
  const [matchup, setMatchup]         = useState<MatchupStatus | null>(null)
  const [pitcherPlayer, setPitcherPl] = useState<Player | null>(null)
  const [batterPlayer, setBatterPl]   = useState<Player | null>(null)
  const [abState, setAbState]         = useState<AtBatState | null>(null)
  const [recState, setRecState]       = useState<RecommendResponse | null>(null)
  const [selectedZone, setZone]       = useState<number | null>(null)
  const [recording, setRecording]     = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll matchup status while loading
  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.matchupStatus()
        setMatchup(s)
        setStatus(s.status)
        if (s.status === 'ready') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          // Enrich stored players with authoritative handedness from Statcast
          if (s.pitcher?.handedness)
            setPitcherPl(p => p ? { ...p, throws: s.pitcher!.handedness } : p)
          if (s.batter?.stands)
            setBatterPl(b => b ? { ...b, bats: s.batter!.stands } : b)
          setView('context')
        } else if (s.status === 'error') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setError(s.error)
        }
      } catch {}
    }, 2000)
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handleLoad(pitcher: Player, batter: Player) {
    setPitcherPl(pitcher)
    setBatterPl(batter)
    setStatus('loading')
    setError(null)
    try {
      await api.loadMatchup(pitcher.name, batter.name, pitcher.id, batter.id)
      startPoll()
    } catch (e: unknown) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleStartAtBat(form: GameContextForm) {
    try {
      const ab = await api.startAtBat(form)
      setAbState(ab)
      setRecState(null)
      setZone(null)
      setView('atbat')
      // Fetch initial recommendations
      const recs = await api.recommend(3)
      setRecState(recs)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRecord(
    pitchType: string, zone: number, result: string, events: string, velocity: number,
  ) {
    setRecording(true)
    try {
      const ab = await api.record(pitchType, zone, result, events, velocity)
      setAbState(ab)
      setZone(null)
      if (!ab.complete) {
        const recs = await api.recommend(3)
        setRecState(recs)
      } else {
        setRecState({ complete: true, ab_result: ab.ab_result ?? undefined, recommendations: [] })
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setRecording(false)
    }
  }

  async function handleNewAtBat() {
    await api.resetAtBat()
    setAbState(null)
    setRecState(null)
    setZone(null)
    setView('context')
  }

  // ── SETUP VIEW ─────────────────────────────────────────────────────────────
  if (view === 'setup') {
    return (
      <div style={styles.center}>
        <div style={styles.brand}>
          <h1>Perfect Pitch AI</h1>
          <p style={styles.tagline}>Intelligent pitch-calling system for catchers</p>
        </div>
        <MatchupSetup onLoad={handleLoad} loading={loadStatus === 'loading'} />
        {loadStatus === 'loading' && (
          <div style={styles.loadingCard}>
            <Spinner />
            <div>
              <div style={{ fontWeight: 600 }}>Fetching Statcast data...</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                First load takes 30–60s. Cached players load instantly.
              </div>
            </div>
          </div>
        )}
        {loadStatus === 'error' && (
          <div style={styles.errorCard}>{loadError}</div>
        )}
      </div>
    )
  }

  // ── GAME CONTEXT VIEW ──────────────────────────────────────────────────────
  if (view === 'context') {
    return (
      <div style={styles.center}>
        <div style={styles.brand}>
          <h1>Perfect Pitch AI</h1>
        </div>
        <GameContext
          pitcher={matchup?.pitcher_name ?? ''}
          batter={matchup?.batter_name ?? ''}
          pitcherPlayer={pitcherPlayer ?? undefined}
          batterPlayer={batterPlayer ?? undefined}
          onStart={handleStartAtBat}
          onLoadMatchup={handleLoad}
          isLoadingMatchup={loadStatus === 'loading'}
        />
      </div>
    )
  }

  // ── AT-BAT VIEW ─────────────────────────────────────────────────────────────
  const zoneMap            = matchup?.batter?.zone_map ?? {}
  const recs               = recState?.recommendations ?? []
  const isComplete         = abState?.complete ?? false
  const availablePitchTypes = matchup?.pitcher?.repertoire
    ? Object.keys(matchup.pitcher.repertoire)
    : undefined

  return (
    <div style={styles.atbatPage}>
      {/* Header */}
      <div style={styles.topBar}>
        <div style={styles.topLeft}>
          <span style={styles.logo}>Perfect Pitch AI</span>
          <MatchupPill pitcherPlayer={pitcherPlayer} batterPlayer={batterPlayer}
            pitcher={abState?.pitcher ?? ''} batter={abState?.batter ?? ''} />
        </div>
        <div style={styles.topRight}>
          {isComplete ? (
            <button style={styles.newAbBtn} onClick={handleNewAtBat}>New At-Bat</button>
          ) : (
            <button style={styles.secondaryBtn} onClick={() => setView('context')}>Setup</button>
          )}
        </div>
      </div>

      {/* At-bat complete banner */}
      {isComplete && (
        <div style={styles.completeBanner}>
          At-bat complete — {formatResult(abState?.ab_result)}
          <button style={{ marginLeft: 16, padding: '4px 12px' }} onClick={handleNewAtBat}>
            Start New At-Bat
          </button>
        </div>
      )}

      {/* 3-column layout */}
      <div style={styles.columns}>
        {/* Left: Strike Zone */}
        <div style={styles.col}>
          <div style={styles.panel}>
            <StrikeZone
              zoneMap={zoneMap as Record<string, ZoneData>}
              recommendations={recs}
              onZoneClick={!isComplete ? setZone : undefined}
              selectedZone={selectedZone}
              batterName={matchup?.batter?.name ?? undefined}
              batterStands={matchup?.batter?.stands ?? undefined}
            />
          </div>
        </div>

        {/* Center: Recommendations */}
        <div style={styles.col}>
          <div style={styles.panel}>
            {isComplete ? (
              <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>
                At-bat complete
              </div>
            ) : (
              <RecommendationPanel
                recommendations={recs}
                count={abState?.count ?? '0-0'}
                leverage={abState?.leverage ?? 1}
                leverageTier={abState?.leverage_tier ?? 'Normal'}
                pitchNum={abState?.pitch_num ?? 1}
              />
            )}
          </div>
        </div>

        {/* Right: Input + Timeline */}
        <div style={styles.col}>
          <div style={styles.panel}>
            <ResultInput
              onRecord={handleRecord}
              preselectedZone={selectedZone}
              disabled={isComplete || recording}
              availablePitchTypes={availablePitchTypes}
            />
          </div>
          <div style={{ ...styles.panel, marginTop: 10 }}>
            <PitchTimeline
              history={abState?.history ?? []}
              balls={abState?.balls ?? 0}
              strikes={abState?.strikes ?? 0}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function formatResult(r: string | null | undefined): string {
  if (!r) return ''
  return r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function Spinner() {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      border: '3px solid var(--border)',
      borderTopColor: 'var(--accent)',
      animation: 'spin 0.8s linear infinite',
      flexShrink: 0,
    }} />
  )
}

const miniPhotoStyle: React.CSSProperties = {
  width: 24, height: 24, borderRadius: '50%',
  objectFit: 'cover', background: 'var(--surface)', flexShrink: 0,
}

function MatchupPill({ pitcher, batter, pitcherPlayer, batterPlayer }: {
  pitcher: string; batter: string
  pitcherPlayer: Player | null; batterPlayer: Player | null
}) {
  const pitcherHand = pitcherPlayer?.throws === 'L' ? 'LHP' : pitcherPlayer?.throws === 'R' ? 'RHP' : null
  const batterHand  = batterPlayer?.bats ? `Bats ${batterPlayer.bats}` : null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '5px 12px 5px 6px',
    }}>
      {/* Pitcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {pitcherPlayer?.id && (
          <img src={headshotUrl(pitcherPlayer.id)} alt='' style={miniPhotoStyle}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{pitcher}</div>
          {pitcherHand && (
            <div style={{ fontSize: 10, fontWeight: 700, color: pitcherHand === 'LHP' ? '#60a5fa' : '#f87171' }}>{pitcherHand}</div>
          )}
        </div>
      </div>

      <span style={{ fontSize: 11, color: 'var(--border)', flexShrink: 0 }}>vs</span>

      {/* Batter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {batterPlayer?.id && (
          <img src={headshotUrl(batterPlayer.id)} alt='' style={miniPhotoStyle}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{batter}</div>
          {batterHand && (
            <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc' }}>{batterHand}</div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  center: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 24,
  },
  brand: {
    textAlign: 'center',
    marginBottom: 4,
  },
  tagline: {
    color: 'var(--muted)',
    fontSize: 13,
    marginTop: 4,
  },
  loadingCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 20px',
    maxWidth: 400,
    width: '100%',
  },
  errorCard: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: 8,
    padding: '10px 16px',
    color: '#ef4444',
    fontSize: 13,
    maxWidth: 400,
    width: '100%',
  },
  atbatPage: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
    flexShrink: 0,
  },
  topLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    fontWeight: 800,
    fontSize: 16,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
  },
  matchupTag: {
    fontSize: 13,
    color: 'var(--muted)',
    background: 'var(--surface2)',
    padding: '3px 10px',
    borderRadius: 20,
    border: '1px solid var(--border)',
  },
  topRight: {
    display: 'flex',
    gap: 8,
  },
  newAbBtn: {
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: 'none',
  },
  secondaryBtn: {
    fontSize: 12,
  },
  completeBanner: {
    background: 'rgba(59,130,246,0.12)',
    border: '1px solid rgba(59,130,246,0.3)',
    borderRadius: 0,
    padding: '8px 16px',
    fontSize: 13,
    color: 'var(--blue)',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'auto 0.75fr 1fr',
    gap: 12,
    padding: 12,
    flex: 1,
    overflow: 'auto',
    alignItems: 'start',
  },
  col: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  panel: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 14,
  },
}
