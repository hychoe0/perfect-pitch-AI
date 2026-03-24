import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Player } from '../types'
import { PlayerSearch } from './PlayerSearch'

interface Props {
  onLoad: (pitcher: Player, batter: Player) => void
  loading: boolean
}

export function MatchupSetup({ onLoad, loading }: Props) {
  const [pitchers, setPitchers] = useState<Player[]>([])
  const [batters, setBatters]   = useState<Player[]>([])
  const [pitcher, setPitcher]   = useState<Player | null>(null)
  const [batter, setBatter]     = useState<Player | null>(null)

  useEffect(() => {
    api.knownPlayers().then(r => {
      setPitchers(r.pitchers)
      setBatters(r.batters)
    }).catch(() => {})
  }, [])

  return (
    <div style={styles.card}>
      <h2 style={{ marginBottom: 16 }}>Load Matchup</h2>

      <div style={styles.matchupRow}>
        <PlayerSearch
          label='Pitcher'
          role='pitcher'
          knownPlayers={pitchers}
          onSelect={setPitcher}
          disabled={loading}
        />
        <div style={styles.vs}>vs</div>
        <PlayerSearch
          label='Batter'
          role='batter'
          knownPlayers={batters}
          onSelect={setBatter}
          disabled={loading}
        />
      </div>

      <button
        style={styles.loadBtn}
        disabled={!pitcher || !batter || loading}
        onClick={() => onLoad(pitcher!, batter!)}
      >
        {loading ? 'Loading data...' : 'Load Matchup'}
      </button>

      <p style={styles.note}>
        Searches all MLB players in Statcast. Data from Baseball Savant (2024–2025).
      </p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 24,
    maxWidth: 600,
    width: '100%',
  },
  matchupRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  vs: {
    paddingTop: 28,
    color: 'var(--muted)',
    fontSize: 16,
    flexShrink: 0,
  },
  loadBtn: {
    width: '100%',
    padding: '10px 0',
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    marginBottom: 10,
  },
  note: {
    fontSize: 11,
    color: 'var(--muted)',
    textAlign: 'center',
  },
}