import { enrichArticleFromSourceFields } from '../excel/resolveArticleFields'
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

/** Chiave stabile per collegare articoli e movimenti (case/spazi). */
export function normalizeArticleRef(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** True se il movimento appartiene all’articolo (articleId o articleCode). */
export function movementMatchesArticle(
  movement: StockMovement,
  articleCode: string,
): boolean {
  const target = normalizeArticleRef(articleCode)
  if (!target) {
    return false
  }
  const byId = normalizeArticleRef(movement.articleId)
  if (byId && byId === target) {
    return true
  }
  const byCode = normalizeArticleRef(movement.articleCode)
  return Boolean(byCode && byCode === target)
}

/** Movimenti dell’articolo, stessa regola usata da scheda e anagrafica. */
export function movementsForArticle(
  movements: StockMovement[],
  articleCode: string,
): StockMovement[] {
  return movements.filter((movement) => movementMatchesArticle(movement, articleCode))
}

/**
 * Indice movimenti → chiave articolo normalizzata.
 * Ogni movimento è indicizzato sia per articleId sia per articleCode.
 */
export function indexMovementsByArticle(
  movements: StockMovement[],
): Map<string, StockMovement[]> {
  const index = new Map<string, StockMovement[]>()

  const add = (rawKey: string, movement: StockMovement) => {
    const key = normalizeArticleRef(rawKey)
    if (!key) {
      return
    }
    const list = index.get(key)
    if (list) {
      if (!list.includes(movement)) {
        list.push(movement)
      }
    } else {
      index.set(key, [movement])
    }
  }

  for (const movement of movements) {
    add(movement.articleId, movement)
    add(movement.articleCode, movement)
  }

  return index
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
 * Usa la stessa base stock della scheda (enrich) e la stessa associazione movimenti.
 */
export function reconcileArticlesWithMovements(
  articles: ArticleRecord[],
  movements: StockMovement[],
): ArticleRecord[] {
  const index = indexMovementsByArticle(movements)

  return articles.map((article) => {
    const enriched = enrichArticleFromSourceFields(article)
    const key = normalizeArticleRef(enriched.code)
    const articleMovements = key ? (index.get(key) ?? []) : []
    return {
      ...enriched,
      currentStock: computeCurrentStock(enriched.stock, articleMovements),
    }
  })
}
