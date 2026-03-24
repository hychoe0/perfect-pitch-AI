import type { Recommendation } from '../types'

interface Props {
  recommendations: Recommendation[]
  count: string
  leverage: number
  leverageTier: string
  pitchNum: number
}

// Color per pitch type
const PT_COLORS: Record<string, string> = {
  FF: '#ef4444', FT: '#fbbf24', SI: '#f97316', FC: '#fb923c',
  SL: '#3b82f6', ST: '#60a5fa', CU: '#a855f7',
  KC: '#c084fc', CH: '#22c55e', FS: '#14b8a6',
}

const TIER_COLORS: Record<string, string> = {
  Low:     '#7b8099',
  Normal:  '#22c55e',
  High:    '#f59e0b',
  Extreme: '#ef4444',
}

export function RecommendationPanel({ recommendations, count, leverage, leverageTier, pitchNum }: Props) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.pitchLabel}>Pitch #{pitchNum} — Count {count}</div>
          <div style={styles.subLabel}>Recommendations</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Leverage</div>
          <div style={{ fontWeight: 700, color: TIER_COLORS[leverageTier] ?? 'var(--text)' }}>
            {leverage.toFixed(2)} <span style={{ fontSize: 11, opacity: 0.7 }}>[{leverageTier}]</span>
          </div>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div style={styles.empty}>No recommendations yet.</div>
      ) : (
        recommendations.map(rec => (
          <RecCard key={`${rec.pitch_type}-${rec.zone}-${rec.rank}`} rec={rec} />
        ))
      )}
    </div>
  )
}

function RecCard({ rec }: { rec: Recommendation }) {
  const color = PT_COLORS[rec.pitch_type] ?? '#7b8099'

  return (
    <div style={{ ...styles.card, borderLeftColor: color }}>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...styles.rankBadge, background: color }}>#{rec.rank}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{rec.pitch_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{rec.pitchcom_desc || rec.pitchcom_dir}</div>
          </div>
        </div>
        <div style={styles.scores}>
          <Stat label='Score' value={rec.score.toFixed(1)} />
          <Stat label='ML' value={`${(rec.ml_prob * 100).toFixed(0)}%`} />
          <Stat label='Whiff' value={`${(rec.whiff * 100).toFixed(0)}%`} />
          <Stat label='CSW' value={`${(rec.csw * 100).toFixed(0)}%`} />
        </div>
      </div>

      {rec.reasons.length > 0 && (
        <ul style={styles.reasons}>
          {rec.reasons.slice(0, 4).map((r, i) => (
            <li key={i} style={styles.reason}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flex: 1,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    marginBottom: 4,
  },
  pitchLabel: { fontWeight: 700, fontSize: 15 },
  subLabel: { fontSize: 12, color: 'var(--muted)' },
  empty: {
    color: 'var(--muted)',
    fontSize: 13,
    padding: '20px 0',
    textAlign: 'center',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderLeft: '4px solid',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  rankBadge: {
    width: 28, height: 28,
    borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, color: '#000',
    flexShrink: 0,
  },
  scores: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  reasons: {
    listStyle: 'none',
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  reason: {
    fontSize: 11,
    color: 'var(--muted)',
    paddingLeft: 10,
    position: 'relative',
  },
}
