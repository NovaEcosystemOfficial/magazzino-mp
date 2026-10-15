import type { StockMovement } from '../types/movements'
import { todayLocalIsoDate } from '../utils/quantity'

export type DailyMovementPoint = {
  date: string
  label: string
  carichi: number
  scarichi: number
}

export function hasRecentMovementActivity(movements: StockMovement[], dayCount = 14): boolean {
  return buildDailyMovementSeries(movements, dayCount).some(
    (point) => point.carichi > 0 || point.scarichi > 0,
  )
}

/** Aggrega i movimenti reali per giorno (ultimi `dayCount` giorni incluso oggi). */
export function buildDailyMovementSeries(
  movements: StockMovement[],
  dayCount = 14,
): DailyMovementPoint[] {
  if (movements.length === 0 || dayCount < 1) {
    return []
  }

  const today = todayLocalIsoDate()
  const end = new Date(`${today}T12:00:00`)
  const points: DailyMovementPoint[] = []

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(end)
    day.setDate(end.getDate() - offset)
    const iso = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'),
    ].join('-')
    points.push({
      date: iso,
      label: `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`,
      carichi: 0,
      scarichi: 0,
    })
  }

  const byDate = new Map(points.map((point) => [point.date, point]))
  for (const movement of movements) {
    const bucket = byDate.get(movement.movementDate)
    if (!bucket) {
      continue
    }
    if (movement.type === 'CARICO') {
      bucket.carichi += 1
    } else {
      bucket.scarichi += 1
    }
  }

  return points
}

type MovementsActivityChartProps = {
  movements: StockMovement[]
}

/**
 * Grafico SVG minimale: conteggio giornaliero di carichi/scarichi dai movimenti esistenti.
 * Non inventa serie: se non ci sono movimenti, non renderizza nulla.
 */
export function MovementsActivityChart({ movements }: MovementsActivityChartProps) {
  const series = buildDailyMovementSeries(movements, 14)
  if (series.length === 0) {
    return null
  }

  const hasActivity = series.some((point) => point.carichi > 0 || point.scarichi > 0)
  if (!hasActivity) {
    return null
  }

  const maxValue = Math.max(
    1,
    ...series.map((point) => Math.max(point.carichi, point.scarichi)),
  )
  const width = 640
  const height = 180
  const padX = 12
  const padTop = 16
  const padBottom = 28
  const chartH = height - padTop - padBottom
  const groupW = (width - padX * 2) / series.length
  const barW = Math.max(3, groupW * 0.28)

  return (
    <div className="movement-chart" role="img" aria-label="Movimenti giornalieri degli ultimi 14 giorni">
      <div className="movement-chart__legend">
        <span className="movement-chart__swatch movement-chart__swatch--carico" />
        Carichi
        <span className="movement-chart__swatch movement-chart__swatch--scarico" />
        Scarichi
      </div>
      <svg
        className="movement-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + chartH * (1 - ratio)
          return (
            <line
              key={ratio}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              className="movement-chart__grid"
            />
          )
        })}
        {series.map((point, index) => {
          const x0 = padX + index * groupW + groupW / 2
          const caricoH = (point.carichi / maxValue) * chartH
          const scaricoH = (point.scarichi / maxValue) * chartH
          return (
            <g key={point.date}>
              <rect
                className="movement-chart__bar movement-chart__bar--carico"
                x={x0 - barW - 1.5}
                y={padTop + chartH - caricoH}
                width={barW}
                height={Math.max(caricoH, point.carichi > 0 ? 2 : 0)}
                rx="1.5"
              >
                <title>{`${point.label}: ${point.carichi} carichi`}</title>
              </rect>
              <rect
                className="movement-chart__bar movement-chart__bar--scarico"
                x={x0 + 1.5}
                y={padTop + chartH - scaricoH}
                width={barW}
                height={Math.max(scaricoH, point.scarichi > 0 ? 2 : 0)}
                rx="1.5"
              >
                <title>{`${point.label}: ${point.scarichi} scarichi`}</title>
              </rect>
              <text
                className="movement-chart__tick"
                x={x0}
                y={height - 8}
                textAnchor="middle"
              >
                {point.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
