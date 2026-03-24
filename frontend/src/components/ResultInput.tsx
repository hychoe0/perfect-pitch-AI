import { useState } from 'react'

interface Props {
  onRecord: (pitchType: string, zone: number, result: string, events: string, velocity: number) => void
  preselectedZone?: number | null
  disabled?: boolean
  availablePitchTypes?: string[]   // codes the pitcher actually throws; undefined = show all
}

const PITCH_TYPES = [
  { code: 'FF', label: '4-Seam',  color: '#ef4444' },
  { code: 'FT', label: '2-Seam',  color: '#fbbf24' },
  { code: 'SI', label: 'Sinker',  color: '#f97316' },
  { code: 'FC', label: 'Cutter',  color: '#fb923c' },
  { code: 'SL', label: 'Slider',  color: '#3b82f6' },
  { code: 'ST', label: 'Sweeper', color: '#60a5fa' },
  { code: 'CU', label: 'Curve',   color: '#a855f7' },
  { code: 'KC', label: 'K-Curve', color: '#c084fc' },
  { code: 'CH', label: 'Change',  color: '#22c55e' },
  { code: 'FS', label: 'Splitter',color: '#14b8a6' },
]

const RESULTS = [
  { code: 'swinging_strike', label: 'Swing-Miss', short: 'K-swing', color: '#ef4444' },
  { code: 'called_strike',   label: 'Called Strike', short: 'K-call', color: '#f59e0b' },
  { code: 'foul',            label: 'Foul',        short: 'Foul',   color: '#94a3b8' },
  { code: 'foul_tip',        label: 'Foul Tip', short: 'K-tip',  color: '#ef4444' },
  { code: 'ball',            label: 'Ball',        short: 'Ball',   color: '#22c55e' },
  { code: 'hit_into_play',   label: 'In Play',     short: 'In play',color: '#3b82f6' },
]

const IN_PLAY_EVENTS = [
  { code: 'field_out',   label: 'Out' },
  { code: 'single',      label: 'Single' },
  { code: 'double',      label: 'Double' },
  { code: 'triple',      label: 'Triple' },
  { code: 'home_run',    label: 'Home Run' },
  { code: 'grounded_into_double_play', label: 'GDP' },
  { code: 'strikeout',   label: 'Strikeout (dropped 3rd)' },
]

const ZONES = [1,2,3,4,5,6,7,8,9,10,11,12,13,14]

export function ResultInput({ onRecord, preselectedZone, disabled, availablePitchTypes }: Props) {
  const visiblePitchTypes = availablePitchTypes
    ? PITCH_TYPES.filter(pt => availablePitchTypes.includes(pt.code))
    : PITCH_TYPES
  const [pitchType, setPitchType] = useState('')
  const [zone, setZone] = useState<number>(preselectedZone ?? 0)
  const [result, setResult] = useState('')
  const [events, setEvents] = useState('')
  const [velocity, setVelocity] = useState('')

  // Sync zone when preselectedZone changes
  const effectiveZone = preselectedZone ?? zone

  const needsEvent = result === 'hit_into_play'
  const canSubmit = pitchType && effectiveZone && result && (!needsEvent || events)

  function handleSubmit() {
    if (!canSubmit) return
    onRecord(pitchType, effectiveZone, result, needsEvent ? events : '', Number(velocity) || 0)
    setResult('')
    setEvents('')
    setVelocity('')
  }

  return (
    <div style={styles.panel}>
      <h3 style={{ marginBottom: 10 }}>Record Pitch Result</h3>

      {/* Pitch type */}
      <div style={styles.section}>
        <label>Pitch Type</label>
        <div style={styles.grid3}>
          {visiblePitchTypes.map(pt => (
            <button
              key={pt.code}
              style={{
                ...styles.chip,
                borderColor: pitchType === pt.code ? pt.color : 'var(--border)',
                background: pitchType === pt.code ? `${pt.color}22` : 'var(--surface2)',
                color: pitchType === pt.code ? pt.color : 'var(--text)',
                fontWeight: pitchType === pt.code ? 700 : 400,
              }}
              onClick={() => setPitchType(pt.code)}
              disabled={disabled}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{pt.code}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>{pt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zone (shows preselected from strike zone click, or manual) */}
      <div style={styles.section}>
        <label>Zone {preselectedZone ? <span style={{ color: 'var(--accent)', fontSize: 11 }}>(from zone click)</span> : ''}</label>
        <div style={styles.zoneGrid}>
          {ZONES.map(z => (
            <button
              key={z}
              style={{
                ...styles.zoneBtn,
                borderColor: effectiveZone === z ? 'var(--accent)' : 'var(--border)',
                background: effectiveZone === z ? 'var(--accent)22' : 'var(--surface2)',
                color: effectiveZone === z ? 'var(--accent)' : 'var(--text)',
                fontWeight: effectiveZone === z ? 700 : 400,
                fontSize: z >= 11 ? 10 : 12,
              }}
              onClick={() => setZone(z)}
              disabled={disabled}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      <div style={styles.section}>
        <label>Result</label>
        <div style={styles.resultGrid}>
          {RESULTS.map(r => (
            <button
              key={r.code}
              style={{
                ...styles.resultBtn,
                borderColor: result === r.code ? r.color : 'var(--border)',
                background: result === r.code ? `${r.color}22` : 'var(--surface2)',
                color: result === r.code ? r.color : 'var(--text)',
                fontWeight: result === r.code ? 700 : 400,
              }}
              onClick={() => { setResult(r.code); setEvents('') }}
              disabled={disabled}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* In-play event selector */}
      {needsEvent && (
        <div style={styles.section}>
          <label>Outcome (In Play)</label>
          <div style={styles.grid3}>
            {IN_PLAY_EVENTS.map(e => (
              <button
                key={e.code}
                style={{
                  ...styles.chip,
                  borderColor: events === e.code ? 'var(--blue)' : 'var(--border)',
                  background: events === e.code ? 'rgba(59,130,246,0.15)' : 'var(--surface2)',
                  color: events === e.code ? 'var(--blue)' : 'var(--text)',
                }}
                onClick={() => setEvents(e.code)}
                disabled={disabled}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Velocity */}
      <div style={styles.section}>
        <label>Velocity (mph) — optional</label>
        <input
          type='number'
          placeholder='e.g. 96.4'
          value={velocity}
          onChange={e => setVelocity(e.target.value)}
          style={{ width: 120 }}
          disabled={disabled}
        />
      </div>

      <button
        style={{
          ...styles.submitBtn,
          opacity: canSubmit && !disabled ? 1 : 0.4,
        }}
        disabled={!canSubmit || disabled}
        onClick={handleSubmit}
      >
        Record Pitch
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 5,
  },
  chip: {
    padding: '5px 6px',
    borderRadius: 6,
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
  },
  zoneGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  zoneBtn: {
    padding: '4px 0',
    borderRadius: 4,
    textAlign: 'center',
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 5,
  },
  resultBtn: {
    padding: '7px 4px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 400,
  },
  submitBtn: {
    padding: '10px 0',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 700,
    border: 'none',
    fontSize: 14,
    marginTop: 4,
  },
}
