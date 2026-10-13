import { parseNumericStock } from '../excel/articoliMapping'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatQuantity } from './quantity'

export type ArticleStockBalance = {
  /** Giacenza iniziale Excel (storica). */
  initialStock: string
  /** Somma quantità movimenti CARICO. */
  totalIn: number
  /** Somma quantità movimenti SCARICO. */
  totalOut: number
  totalInLabel: string
  totalOutLabel: string
  /** Giacenza attuale = iniziale + entrate − uscite. */
  currentStock: string
  currentStockValue: number
}

/**
 * Unica logica di giacenza operativa:
 * attuale = giacenza iniziale + totale entrate − totale uscite.
 * I movimenti non vengono modificati; si usa solo la loro somma.
 */
export function summarizeMovements(movements: StockMovement[]): {
  totalIn: number
  totalOut: number
} {
  let totalIn = 0
  let totalOut = 0
  for (const movement of movements) {
    if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) {
      continue
    }
    if (movement.type === 'CARICO') {
      totalIn += movement.quantity
    } else if (movement.type === 'SCARICO') {
      totalOut += movement.quantity
    }
  }
  return { totalIn, totalOut }
}

export function computeCurrentStockValue(
  initialStock: string,
  movements: StockMovement[],
): number {
  const initial = parseNumericStock(initialStock) ?? 0
  const { totalIn, totalOut } = summarizeMovements(movements)
  return initial + totalIn - totalOut
}

export function computeCurrentStock(
  initialStock: string,
  movements: StockMovement[],
): string {
  return formatQuantity(computeCurrentStockValue(initialStock, movements))
}

export function buildArticleStockBalance(
  initialStock: string,
  movements: StockMovement[],
): ArticleStockBalance {
  const { totalIn, totalOut } = summarizeMovements(movements)
  const currentStockValue = computeCurrentStockValue(initialStock, movements)
  return {
    initialStock,
    totalIn,
    totalOut,
    totalInLabel: formatQuantity(totalIn),
    totalOutLabel: formatQuantity(totalOut),
    currentStock: formatQuantity(currentStockValue),
    currentStockValue,
  }
}

/**
 * Allinea in memoria currentStock alla formula, senza scrivere IndexedDB.
 * Usato da UI/report/backup export per valori coerenti tra schermate.
 */
export function reconcileArticlesWithMovements(
  articles: ArticleRecord[],
  movements: StockMovement[],
): ArticleRecord[] {
  const byArticleId = new Map<string, StockMovement[]>()
  for (const movement of movements) {
    const key = movement.articleId.trim().toLowerCase()
    if (!key) {
      continue
    }
    const list = byArticleId.get(key)
    if (list) {
      list.push(movement)
    } else {
      byArticleId.set(key, [movement])
    }
  }

  return articles.map((article) => {
    const key = article.code.trim().toLowerCase()
    const articleMovements = byArticleId.get(key) ?? []
    return {
      ...article,
      currentStock: computeCurrentStock(article.stock, articleMovements),
    }
  })
}
