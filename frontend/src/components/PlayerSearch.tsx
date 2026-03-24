import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Player } from '../types'

// MLB headshot CDN — falls back to generic silhouette automatically
export function headshotUrl(id: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/67/current`
}

const badge: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '1px 6px',
  borderRadius: 4, flexShrink: 0, letterSpacing: '0.03em',
}

export function HandBadge({ player, role }: { player: Player; role: 'pitcher' | 'batter' }) {
  if (role === 'pitcher') {
    const label = player.throws === 'L' ? 'LHP' : player.throws === 'R' ? 'RHP' : null
    if (!label) return null
    return <span style={{ ...badge, background: label === 'LHP' ? 'rgba(59,130,246,0.18)' : 'rgba(239,68,68,0.18)', color: label === 'LHP' ? '#60a5fa' : '#f87171' }}>{label}</span>
  }
  const label = player.bats === 'L' ? 'L' : player.bats === 'R' ? 'R' : player.bats === 'S' ? 'S' : null
  if (!label) return null
  return <span style={{ ...badge, background: 'rgba(168,85,247,0.18)', color: '#c084fc' }}>Bats {label}</span>
}

interface SearchProps {
  label: string
  role: 'pitcher' | 'batter'
  knownPlayers: Player[]
  onSelect: (player: Player) => void
  disabled: boolean
}

export function PlayerSearch({ label, role, knownPlayers, onSelect, disabled }: SearchProps) {
  const [query, setQuery]         = useState('')
  const [suggestions, setSugg]    = useState<Player[]>([])
  const [open, setOpen]           = useState(false)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected]   = useState<Player | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) setSugg(knownPlayers)
  }, [knownPlayers])

  useEffect(() => {
    const q = query.trim()
    if (selected && selected.name === q) return

    if (q.length < 2) {
      setSugg(knownPlayers.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase())))
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await api.searchPlayers(q)
        setSugg(results)
        setOpen(true)
      } catch {
        setSugg(knownPlayers.filter(p => p.name.toLowerCase().includes(q.toLowerCase())))
      } finally {
        setSearching(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function select(p: Player) {
    setQuery(p.name)
    setSelected(p)
    onSelect(p)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type='text'
          value={query}
          placeholder={`Search any MLB ${label.toLowerCase()}...`}
          onChange={e => { setQuery(e.target.value); setSelected(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
        />
        {searching && <div style={styles.spinner} />}
      </div>

      {open && suggestions.length > 0 && (
        <div style={styles.dropdown}>
          {suggestions.map(p => (
            <div key={p.id} style={styles.row} onMouseDown={() => select(p)}>
              <img
                src={headshotUrl(p.id)}
                alt=''
                style={styles.photo}
                onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
              />
              <div style={styles.info}>
                <span style={styles.playerName}>{p.name}</span>
                {p.team && <span style={styles.teamTag}>{p.team}</span>}
                <HandBadge player={p} role={role} />
              </div>
            </div>
          ))}
        </div>
      )}

      {open && !searching && suggestions.length === 0 && query.trim().length >= 2 && (
        <div style={styles.dropdown}>
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)' }}>No players found</div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    zIndex: 100,
    maxHeight: 280,
    overflowY: 'auto',
    marginTop: 2,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
  },
  photo: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    objectFit: 'cover',
    background: 'var(--surface)',
    flexShrink: 0,
  },
  info: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
  },
  teamTag: {
    fontSize: 10,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  spinner: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent)',
    animation: 'spin 0.7s linear infinite',
  },
}
