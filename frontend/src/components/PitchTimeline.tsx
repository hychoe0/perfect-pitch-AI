import type { PitchHistoryEntry } from '../types'

interface Props {
  history: PitchHistoryEntry[]
  balls: number
  strikes: number
}

const RESULT_COLORS: Record<string, string> = {
  swinging_strike:         '#ef4444',
  swinging_strike_blocked: '#ef4444',
  called_strike:           '#f59e0b',
  foul:                    '#94a3b8',
  foul_tip:                '#ef4444',
  ball:                    '#22c55e',
  hit_into_play:           '#3b82f6',
}

const RESULT_LABELS: Record<string, string> = {
  swinging_strike:         'K⚡',
  swinging_strike_blocked: 'K⚡',
  called_strike:           'K✓',
  foul:                    'F',
  foul_tip:                'K⚡',
  ball:                    'B',
  hit_into_play:           'IP',
}

const PT_COLORS: Record<string, string> = {
  FF: '#ef4444', FT: '#fbbf24', SI: '#f97316', FC: '#fb923c',
  SL: '#3b82f6', ST: '#60a5fa', CU: '#a855f7',
  KC: '#c084fc', CH: '#22c55e', FS: '#14b8a6',
}

// Count dot display
function CountDots({ filled, total, color }: { filled: number; total: number; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i < filled ? color : 'var(--surface2)',
            border: `1px solid ${i < filled ? color : 'var(--border)'}`,
          }}
        />
      ))}
    </div>
  )
}

export function PitchTimeline({ history, balls, strikes }: Props) {
  return (
    <div style={styles.container}>
      {/* Count display */}
      <div style={styles.countBar}>
        <div style={styles.countBlock}>
          <span style={styles.countLabel}>Balls</span>
          <CountDots filled={balls} total={4} color='#22c55e' />
        </div>
        <div style={styles.countBig}>
          {balls}-{strikes}
        </div>
        <div style={styles.countBlock}>
          <span style={styles.countLabel}>Strikes</span>
          <CountDots filled={strikes} total={3} color='#ef4444' />
        </div>
      </div>

      {/* Pitch sequence */}
      {history.length === 0 ? (
        <p style={styles.empty}>No pitches yet</p>
      ) : (
        <div style={styles.timeline}>
          {history.map(p => {
            const resultColor = RESULT_COLORS[p.result] ?? '#7b8099'
            const resultLabel = RESULT_LABELS[p.result] ?? p.result
            const ptColor = PT_COLORS[p.pt] ?? '#7b8099'

            return (
              <div key={p.num} style={styles.pitchBlock}>
                {/* Sequence number */}
                <div style={styles.seqNum}>{p.num}</div>

                {/* Pitch type badge */}
                <div style={{ ...styles.ptBadge, background: ptColor }}>
                  {p.pt}
                </div>

                {/* Zone */}
                <div style={styles.zone}>Z{p.zone}</div>

                {/* Result */}
                <div style={{ ...styles.resultBadge, background: `${resultColor}22`, color: resultColor, borderColor: resultColor }}>
                  {resultLabel}
                </div>

                {/* Velocity */}
                {p.velocity > 0 && (
                  <div style={styles.velo}>{p.velocity.toFixed(1)}</div>
                )}

                {/* Events label */}
                {p.events && (
                  <div style={styles.events}>
                    {p.events.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                )}

                {/* Connector line */}
                {true && <div style={styles.connector} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  countBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'var(--surface2)',
    borderRadius: 8,
    border: '1px solid var(--border)',
  },
  countBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
  },
  countLabel: {
    fontSize: 10,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  countBig: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
  },
  empty: {
    color: 'var(--muted)',
    fontSize: 12,
    textAlign: 'center',
    padding: '8px 0',
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  pitchBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    position: 'relative',
  },
  seqNum: {
    width: 20,
    fontSize: 11,
    color: 'var(--muted)',
    textAlign: 'right',
    flexShrink: 0,
  },
  ptBadge: {
    width: 34,
    height: 24,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#000',
    flexShrink: 0,
  },
  zone: {
    fontSize: 11,
    color: 'var(--muted)',
    width: 28,
    flexShrink: 0,
  },
  resultBadge: {
    borderRadius: 4,
    border: '1px solid',
    padding: '2px 7px',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  velo: {
    fontSize: 11,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  events: {
    fontSize: 11,
    color: 'var(--text)',
    fontWeight: 600,
  },
  connector: {
    display: 'none', // could add vertical line later
  },
}
