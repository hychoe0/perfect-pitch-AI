import type { Recommendation, ZoneData } from '../types'

interface Props {
  zoneMap: Record<string, ZoneData>
  recommendations: Recommendation[]
  onZoneClick?: (zone: number) => void
  selectedZone?: number | null
  batterName?: string
  batterStands?: string   // 'L' | 'R' | 'S'
}

// ── Layout constants ──────────────────────────────────────────────────────────
const CELL    = 72
const CHASE_W = 36
const CHASE_H = 44
const FRAME   = 16

// Silhouette: 1344×3094 px (aspect ~1:2.302), original = left-handed batter
const SILO_W = 180
const SILO_H = Math.round(SILO_W * 3094 / 1344) // ≈ 414

// TOP_PAD aligns GY (top of zones 1–9) to ~35% of SILO_H (mid-torso/waist level)
// → zone bottom lands at ~87% of SILO_H ≈ knee height
const TOP_PAD = Math.round(SILO_H * 0.35) - CHASE_H // ≈ 101

const SX = FRAME
const SY = TOP_PAD                               // ≈ 101
const SW = CHASE_W * 2 + CELL * 3               // 288
const SH = CHASE_H * 2 + CELL * 3               // 304

const GX = SX + CHASE_W                          // 52
const GY = SY + CHASE_H                          // ≈ 145
const GW = CELL * 3                              // 216
const GH = CELL * 3                              // 216

const SVG_W_BASE = FRAME * 2 + SW                         // 320
const SVG_H      = Math.max(TOP_PAD + SH + FRAME, SILO_H + 10) // ≈ 424

type Rect = [number, number, number, number]

const ZONE_RECTS: Record<number, Rect> = {
  1: [GX,            GY,            CELL, CELL],
  2: [GX + CELL,     GY,            CELL, CELL],
  3: [GX + CELL * 2, GY,            CELL, CELL],
  4: [GX,            GY + CELL,     CELL, CELL],
  5: [GX + CELL,     GY + CELL,     CELL, CELL],
  6: [GX + CELL * 2, GY + CELL,     CELL, CELL],
  7: [GX,            GY + CELL * 2, CELL, CELL],
  8: [GX + CELL,     GY + CELL * 2, CELL, CELL],
  9: [GX + CELL * 2, GY + CELL * 2, CELL, CELL],
  11: [SX,                SY,                SW,     CHASE_H],
  12: [SX,                SY + CHASE_H + GH, SW,     CHASE_H],
  13: [SX,                SY + CHASE_H,      CHASE_W, GH],
  14: [SX + CHASE_W + GW, SY + CHASE_H,      CHASE_W, GH],
}

const RANK_COLORS = ['#22c55e', '#3b82f6', '#a855f7']

// Badge geometry
const BR  = 7    // badge radius
const GAP = 16   // center-to-center between sibling badges

function whiffColor(rate: number, hardHit: number): string {
  if (hardHit > 0.30) return `rgba(239,68,68,${0.25 + hardHit * 0.5})`
  const t = Math.min(rate / 0.45, 1)
  if (t < 0.5) {
    const u = t * 2
    return `rgba(${Math.round(34 + u * 217)},${Math.round(197 - u * 6)},0,${0.15 + t * 0.55})`
  }
  const u = (t - 0.5) * 2
  return `rgba(251,${Math.round(191 - u * 191)},0,${0.4 + u * 0.4})`
}

function badgePositions(
  recs: Recommendation[],
  x: number, y: number, w: number, _h: number,
  z: number,
): Array<{ cx: number; cy: number; color: string; rank: number }> {
  const vertical = z === 13 || z === 14
  return recs.map((rec, i) => {
    const color = RANK_COLORS[(rec.rank - 1) % RANK_COLORS.length]
    if (vertical) {
      return { cx: x + w / 2, cy: y + BR + 14 + i * GAP, color, rank: rec.rank }
    } else {
      return { cx: x + w - BR - 4 - i * GAP, cy: y + BR + 4, color, rank: rec.rank }
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
export function StrikeZone({
  zoneMap, recommendations, onZoneClick, selectedZone,
  batterName, batterStands,
}: Props) {
  const recByZone: Record<number, Recommendation[]> = {}
  recommendations.forEach(r => {
    if (!recByZone[r.zone]) recByZone[r.zone] = []
    recByZone[r.zone].push(r)
  })

  const cursor   = onZoneClick ? 'pointer' : 'default'
  const hasSilo  = !!batterStands
  const isRHH    = hasSilo && batterStands !== 'L'  // RHH/S → left side, mirrored

  // LHH: image as-drawn, placed right of zone
  // RHH: scale(-1,1) mirrors the image; negative-x area revealed via viewBox offset
  const svgWidth      = hasSilo ? SVG_W_BASE + SILO_W : SVG_W_BASE
  const viewBoxX      = isRHH ? -SILO_W : 0
  const siloTransform = isRHH ? 'scale(-1, 1)' : `translate(${SVG_W_BASE}, 0)`

  const handLabel = batterStands === 'L' ? 'LHH'
                  : batterStands === 'R' ? 'RHH'
                  : batterStands === 'S' ? 'S' : ''
  const year = new Date().getFullYear()

  function renderZone(z: number) {
    const [x, y, w, h] = ZONE_RECTS[z]
    const zd       = zoneMap[String(z)]
    const recs     = recByZone[z] ?? []
    const topRec   = recs[0]
    const selected = selectedZone === z
    const isShadow = z >= 11
    const borderColor = topRec ? RANK_COLORS[(topRec.rank - 1) % RANK_COLORS.length] : null

    const fill = zd
      ? whiffColor(zd.whiff_rate, zd.hard_hit)
      : isShadow ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'

    const badges = badgePositions(recs, x, y, w, h, z)

    return (
      <g key={z} onClick={() => onZoneClick?.(z)} style={{ cursor }}>
        <rect
          x={x} y={y} width={w} height={h}
          rx={isShadow ? 3 : 2}
          fill={fill}
          stroke={
            selected    ? '#ffffff' :
            borderColor ? borderColor :
            isShadow    ? 'rgba(255,255,255,0.07)' :
                          'rgba(255,255,255,0.18)'
          }
          strokeWidth={selected ? 2.5 : borderColor ? 2 : 1}
        />
        <text x={x + 5} y={y + 11} fontSize={9} fill='rgba(255,255,255,0.28)' fontWeight='600'>
          {z}
        </text>
        {zd && (
          <text
            x={x + w / 2} y={y + h / 2 + 4}
            textAnchor='middle'
            fontSize={isShadow ? 11 : 13}
            fill='rgba(255,255,255,0.85)'
            fontWeight='700'
          >
            {(zd.whiff_rate * 100).toFixed(0)}%
          </text>
        )}
        {badges.map(({ cx, cy, color, rank }) => (
          <g key={rank}>
            <circle cx={cx} cy={cy} r={BR} fill={color} />
            <text
              x={cx} y={cy + 3}
              textAnchor='middle' fontSize={9} fontWeight='800' fill='#000'
            >
              {rank}
            </text>
          </g>
        ))}
      </g>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>

      {/* Player header */}
      {batterName ? (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textAlign: 'center', letterSpacing: '0.01em' }}>
          {batterName}
          {handLabel && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> ({handLabel})</span>}
          {' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{year}</span>
        </div>
      ) : (
        <h3 style={{ color: 'var(--muted)', textAlign: 'center' }}>Strike Zone</h3>
      )}

      <svg
        width={svgWidth} height={SVG_H}
        viewBox={`${viewBoxX} 0 ${svgWidth} ${SVG_H}`}
        style={{ display: 'block' }}
      >

        {/* Zone 10 — ball zone (outermost blue frame, covers only the zone area) */}
        <g onClick={() => onZoneClick?.(10)} style={{ cursor }}>
          <rect
            x={0} y={0} width={SVG_W_BASE} height={SVG_H}
            rx={6}
            fill={selectedZone === 10 ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.10)'}
            stroke={selectedZone === 10 ? '#3b82f6' : 'rgba(59,130,246,0.40)'}
            strokeWidth={selectedZone === 10 ? 2.5 : 1.5}
          />
          <text x={6} y={14} fontSize={9} fill='rgba(59,130,246,0.70)' fontWeight='700'>10</text>
          <text x={SVG_W_BASE / 2} y={10} textAnchor='middle' fontSize={9} fill='rgba(59,130,246,0.50)'>BALL</text>
        </g>

        {/* Shadow zones 11-14 */}
        {[11, 12, 13, 14].map(renderZone)}

        {/* Strike zones 1-9 */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(renderZone)}

        {/* Strike zone outer border */}
        <rect
          x={GX} y={GY} width={GW} height={GH}
          fill='none' stroke='rgba(255,255,255,0.35)' strokeWidth={2} rx={2}
          pointerEvents='none'
        />

        {/* Shadow zone outer border */}
        <rect
          x={SX} y={SY} width={SW} height={SH}
          fill='none' stroke='rgba(255,255,255,0.12)' strokeWidth={1} rx={3}
          pointerEvents='none'
        />

        {/* "Strike Zone" label — centered in bottom shadow row */}
        <text
          x={GX + GW / 2} y={GY + GH + CHASE_H / 2 + 4}
          textAnchor='middle' fontSize={10} fontWeight={600}
          fill='rgba(255,255,255,0.28)'
          pointerEvents='none'
        >
          Strike Zone
        </text>

        {/* Batter silhouette — LHH right of zone, RHH mirrored left of zone */}
        {hasSilo && (
          <image
            href='/batter_silhouette.png'
            x={0} y={0}
            width={SILO_W} height={SILO_H}
            preserveAspectRatio='xMidYMid meet'
            opacity={0.45}
            transform={siloTransform}
            pointerEvents='none'
          />
        )}
      </svg>

      <div style={styles.legend}>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>Whiff % —</span>
        <span style={styles.item}><span style={{ ...styles.dot, background: 'rgba(34,197,0,0.5)' }} /> Low</span>
        <span style={styles.item}><span style={{ ...styles.dot, background: 'rgba(251,191,0,0.7)' }} /> Med</span>
        <span style={styles.item}><span style={{ ...styles.dot, background: 'rgba(251,0,0,0.75)' }} /> High</span>
        <span style={styles.item}><span style={{ ...styles.dot, background: 'rgba(239,68,68,0.7)' }} /> Hard-hit</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  legend: {
    display: 'flex', gap: 10, alignItems: 'center',
    fontSize: 11, flexWrap: 'wrap', justifyContent: 'center',
  },
  item: { display: 'flex', alignItems: 'center', gap: 4 },
  dot:  { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
}