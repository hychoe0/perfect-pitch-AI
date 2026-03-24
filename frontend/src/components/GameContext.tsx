import { useState, useEffect } from 'react'
import { api } from '../api'
import type { GameContextForm, Player } from '../types'
import { PlayerSearch, HandBadge, headshotUrl } from './PlayerSearch'

interface Props {
  pitcher: string
  batter: string
  pitcherPlayer?: Player
  batterPlayer?: Player
  onStart: (form: GameContextForm) => void
  onLoadMatchup: (pitcher: Player, batter: Player) => void
  isLoadingMatchup?: boolean
}

const GAME_TYPES = [
  { value: 'R', label: 'Regular Season' },
  { value: 'D', label: 'Division Series' },
  { value: 'L', label: 'Championship Series' },
  { value: 'W', label: 'World Series' },
]

export function GameContext({
  pitcher, batter, pitcherPlayer, batterPlayer,
  onStart, onLoadMatchup, isLoadingMatchup,
}: Props) {
  const [form, setForm] = useState<GameContextForm>({
    inning: 1, outs: 0,
    on_1b: false, on_2b: false, on_3b: false,
    home_score: 0, away_score: 0,
    game_type: 'R',
  })

  // 'pitcher' | 'batter' | null — only one side open at a time
  const [changingSide, setChangingSide] = useState<'pitcher' | 'batter' | null>(null)
  const [pendingPlayer, setPendingPlayer] = useState<Player | null>(null)

  const [knownPitchers, setKnownPitchers] = useState<Player[]>([])
  const [knownBatters, setKnownBatters]   = useState<Player[]>([])

  // pitcherIsHome: true = pitcher's team is home, false = batter's team is home
  const [pitcherIsHome, setPitcherIsHome] = useState(true)

  useEffect(() => {
    if (changingSide && knownPitchers.length === 0) {
      api.knownPlayers().then(r => {
        setKnownPitchers(r.pitchers)
        setKnownBatters(r.batters)
      }).catch(() => {})
    }
  }, [changingSide])

  const set = <K extends keyof GameContextForm>(k: K, v: GameContextForm[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // Score keys based on who's home
  const pitcherScoreKey: keyof GameContextForm = pitcherIsHome ? 'home_score' : 'away_score'
  const batterScoreKey: keyof GameContextForm  = pitcherIsHome ? 'away_score' : 'home_score'
  const pitcherLast = pitcher.split(' ').slice(-1)[0] ?? pitcher
  const batterLast  = batter.split(' ').slice(-1)[0] ?? batter

  function openChange(side: 'pitcher' | 'batter') {
    setChangingSide(prev => prev === side ? null : side)
    setPendingPlayer(null)
  }

  function confirmChange() {
    if (!pendingPlayer) return
    const p = pitcherPlayer ?? { name: pitcher, id: 0 }
    const b = batterPlayer  ?? { name: batter,  id: 0 }
    onLoadMatchup(
      changingSide === 'pitcher' ? pendingPlayer : p,
      changingSide === 'batter'  ? pendingPlayer : b,
    )
    setChangingSide(null)
    setPendingPlayer(null)
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h2>At-Bat Setup</h2>
      </div>

      {/* Player matchup row */}
      <div style={styles.matchupArea}>
        {/* Pitcher column */}
        <div style={styles.playerCol}>
          <PlayerCard player={pitcherPlayer} name={pitcher} role='pitcher' />
          <button
            style={{ ...styles.changePlayerBtn, ...(changingSide === 'pitcher' ? styles.changePlayerBtnActive : {}) }}
            onClick={() => openChange('pitcher')}
            disabled={!!isLoadingMatchup}
          >
            {changingSide === 'pitcher' ? '✕ Cancel' : '↻ Change Pitcher'}
          </button>
        </div>

        <span style={styles.vs}>vs</span>

        {/* Batter column */}
        <div style={{ ...styles.playerCol, alignItems: 'flex-end' }}>
          <PlayerCard player={batterPlayer} name={batter} role='batter' align='right' />
          <button
            style={{ ...styles.changePlayerBtn, ...(changingSide === 'batter' ? styles.changePlayerBtnActive : {}) }}
            onClick={() => openChange('batter')}
            disabled={!!isLoadingMatchup}
          >
            {changingSide === 'batter' ? '✕ Cancel' : '↻ Change Batter'}
          </button>
        </div>
      </div>

      {/* Inline change search — appears below matchup row */}
      {changingSide && (
        <div style={styles.searchBox}>
          <div style={styles.searchBoxLabel}>
            {changingSide === 'pitcher' ? 'Select new pitcher' : 'Select new batter'}
          </div>
          <PlayerSearch
            label={changingSide === 'pitcher' ? 'New Pitcher' : 'New Batter'}
            role={changingSide}
            knownPlayers={changingSide === 'pitcher' ? knownPitchers : knownBatters}
            onSelect={setPendingPlayer}
            disabled={!!isLoadingMatchup}
          />
          <button
            style={styles.loadBtn}
            disabled={!pendingPlayer || !!isLoadingMatchup}
            onClick={confirmChange}
          >
            {isLoadingMatchup ? 'Loading…' : `Load with new ${changingSide}`}
          </button>
        </div>
      )}

      {isLoadingMatchup && (
        <div style={styles.loadingRow}>
          <div style={styles.spinner} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Fetching Statcast data…</span>
        </div>
      )}

      {/* Game context form */}
      <div style={styles.grid}>
        <div style={styles.field}>
          <label>Inning</label>
          <input
            type='number' min={1} max={20}
            value={form.inning}
            onChange={e => set('inning', Number(e.target.value))}
          />
        </div>

        <div style={styles.field}>
          <label>Outs</label>
          <div style={styles.btnGroup}>
            {[0, 1, 2].map(o => (
              <button
                key={o}
                style={{ ...styles.toggleBtn, ...(form.outs === o ? styles.toggleActive : {}) }}
                onClick={() => set('outs', o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.field}>
          <label>Runners on Base</label>
          <div style={styles.diamond}>
            <div style={styles.diamondField}>
              <Base label='2B' active={form.on_2b} onClick={() => set('on_2b', !form.on_2b)} pos='top' />
              <div style={styles.diamondMid}>
                <Base label='3B' active={form.on_3b} onClick={() => set('on_3b', !form.on_3b)} pos='left' />
                <div style={styles.homePlate} />
                <Base label='1B' active={form.on_1b} onClick={() => set('on_1b', !form.on_1b)} pos='right' />
              </div>
            </div>
          </div>
        </div>

        {/* Score with home/away flip */}
        <div style={styles.field}>
          <label>Score</label>
          <div style={styles.scoreRow}>
            <div style={styles.scoreCol}>
              <span style={styles.scoreTeamLabel}>
                <span style={{ color: pitcherIsHome ? 'var(--accent)' : 'var(--muted)' }}>
                  {pitcherIsHome ? 'Home' : 'Away'}
                </span>
                {' · '}{pitcherLast}
              </span>
              <input
                type='number' min={0} max={30}
                value={form[pitcherScoreKey] as number}
                onChange={e => set(pitcherScoreKey, Number(e.target.value))}
                style={{ width: 56, textAlign: 'center' }}
              />
            </div>

            <div style={styles.scoreMiddle}>
              <button
                style={styles.flipBtn}
                onClick={() => setPitcherIsHome(h => !h)}
                title='Flip home / away'
              >
                ⇄
              </button>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>–</span>
            </div>

            <div style={styles.scoreCol}>
              <span style={styles.scoreTeamLabel}>
                <span style={{ color: pitcherIsHome ? 'var(--muted)' : 'var(--accent)' }}>
                  {pitcherIsHome ? 'Away' : 'Home'}
                </span>
                {' · '}{batterLast}
              </span>
              <input
                type='number' min={0} max={30}
                value={form[batterScoreKey] as number}
                onChange={e => set(batterScoreKey, Number(e.target.value))}
                style={{ width: 56, textAlign: 'center' }}
              />
            </div>
          </div>
        </div>

        <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
          <label>Game Type</label>
          <div style={styles.btnGroup}>
            {GAME_TYPES.map(gt => (
              <button
                key={gt.value}
                style={{ ...styles.toggleBtn, ...(form.game_type === gt.value ? styles.toggleActive : {}) }}
                onClick={() => set('game_type', gt.value)}
              >
                {gt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button style={styles.startBtn} onClick={() => onStart(form)}>
        Start At-Bat
      </button>
    </div>
  )
}

// ── Player card ──────────────────────────────────────────────────────────────
function PlayerCard({
  player, name, role, align = 'left',
}: {
  player?: Player; name: string; role: 'pitcher' | 'batter'; align?: 'left' | 'right'
}) {
  const id = player?.id
  const isRight = align === 'right'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: isRight ? 'row-reverse' : 'row' }}>
      {id ? (
        <img
          src={headshotUrl(id)}
          alt=''
          style={styles.cardPhoto}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
        />
      ) : (
        <div style={styles.cardPhotoPlaceholder} />
      )}
      <div style={{ textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{name || (player?.name ?? '—')}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', justifyContent: isRight ? 'flex-end' : 'flex-start' }}>
          {player && <HandBadge player={player} role={role} />}
          {player?.position && <span style={styles.chip}>{player.position}</span>}
          {player?.team     && <span style={styles.chip}>{player.team}</span>}
        </div>
      </div>
    </div>
  )
}

function Base({ label, active, onClick, pos }: {
  label: string; active: boolean; onClick: () => void; pos: string
}) {
  const posStyle: React.CSSProperties =
    pos === 'top'   ? { alignSelf: 'flex-start', margin: '0 auto' } :
    pos === 'left'  ? { marginRight: 'auto' } :
    pos === 'right' ? { marginLeft: 'auto' } : {}

  return (
    <button
      onClick={onClick}
      style={{
        ...posStyle,
        width: 32, height: 32, borderRadius: 4,
        transform: 'rotate(45deg)',
        background: active ? 'var(--yellow)' : 'var(--surface2)',
        border: `2px solid ${active ? 'var(--yellow)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, flexShrink: 0,
      }}
      title={label}
    >
      <span style={{ transform: 'rotate(-45deg)', fontSize: 9, fontWeight: 700, color: active ? '#000' : 'var(--muted)' }}>
        {label}
      </span>
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 24,
    maxWidth: 580,
    width: '100%',
  },
  header: {
    marginBottom: 16,
  },
  matchupArea: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
    padding: '14px 14px 10px',
    background: 'var(--surface2)',
    borderRadius: 10,
    border: '1px solid var(--border)',
  },
  playerCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
  },
  vs: {
    color: 'var(--muted)',
    fontSize: 12,
    flexShrink: 0,
    paddingTop: 20,
  },
  changePlayerBtn: {
    fontSize: 11,
    padding: '3px 8px',
    color: 'var(--muted)',
    borderColor: 'var(--border)',
    borderRadius: 4,
  },
  changePlayerBtnActive: {
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  cardPhoto: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    objectFit: 'cover',
    background: 'var(--surface)',
    flexShrink: 0,
    border: '2px solid var(--border)',
  },
  cardPhotoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'var(--surface)',
    flexShrink: 0,
    border: '2px solid var(--border)',
  },
  chip: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'var(--surface)',
    color: 'var(--muted)',
    border: '1px solid var(--border)',
  },
  searchBox: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  searchBoxLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  loadBtn: {
    width: '100%',
    padding: '8px 0',
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: 13,
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    padding: '8px 12px',
    background: 'var(--surface2)',
    borderRadius: 6,
  },
  spinner: {
    width: 14, height: 14,
    borderRadius: '50%',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent)',
    animation: 'spin 0.7s linear infinite',
    flexShrink: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 20,
    marginTop: 16,
  },
  field: {},
  btnGroup: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  toggleBtn: {
    flex: '1 1 auto',
    padding: '6px 10px',
    fontSize: 12,
  },
  toggleActive: {
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: '1px solid var(--accent)',
  },
  diamond: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 4,
  },
  diamondField: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    width: 120,
  },
  diamondMid: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    gap: 4,
  },
  homePlate: {
    flex: 1,
    height: 2,
    background: 'var(--border)',
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 6,
  },
  scoreCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  scoreTeamLabel: {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--muted)',
  },
  scoreMiddle: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingBottom: 2,
  },
  flipBtn: {
    fontSize: 14,
    padding: '2px 6px',
    color: 'var(--muted)',
    borderColor: 'var(--border)',
    borderRadius: 4,
    lineHeight: 1,
  },
  startBtn: {
    width: '100%',
    padding: '10px 0',
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: 14,
  },
}