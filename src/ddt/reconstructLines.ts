import type { DdtTextItem } from '../types/ddt'

export type ReconstructedLine = {
  y: number
  text: string
  items: DdtTextItem[]
}

/**
 * Raggruppa gli item PDF per riga (Y) e li ordina da sinistra a destra.
 * Non unisce righe diverse: solo clustering geometrico con tolleranza.
 */
export function reconstructLines(
  items: DdtTextItem[],
  yTolerance = 3.5,
): ReconstructedLine[] {
  const usable = items.filter((item) => item.str.trim().length > 0)
  if (usable.length === 0) {
    return []
  }

  const sorted = [...usable].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) {
      return b.y - a.y
    }
    return a.x - b.x
  })

  const clusters: { y: number; items: DdtTextItem[] }[] = []

  for (const item of sorted) {
    const cluster = clusters.find((entry) => Math.abs(entry.y - item.y) <= yTolerance)
    if (cluster) {
      cluster.items.push(item)
      cluster.y =
        cluster.items.reduce((sum, current) => sum + current.y, 0) / cluster.items.length
    } else {
      clusters.push({ y: item.y, items: [item] })
    }
  }

  return clusters
    .map((cluster) => {
      const ordered = [...cluster.items].sort((a, b) => a.x - b.x)
      const text = ordered
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      return {
        y: cluster.y,
        text,
        items: ordered,
      }
    })
    .filter((line) => line.text.length > 0)
    .sort((a, b) => b.y - a.y)
}

export function linesToPlainText(lines: ReconstructedLine[]): string {
  return lines.map((line) => line.text).join('\n')
}
