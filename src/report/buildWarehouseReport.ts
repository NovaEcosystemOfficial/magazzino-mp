import { buildDdtRegistry, type DdtRegistryEntry } from '../ddt/buildDdtRegistry'
import { parseNumericStock } from '../excel/articoliMapping'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatQuantity } from '../utils/quantity'
import { isDateInPeriod, type ReportPeriod } from './period'

export type QuantityByUnit = {
  unit: string
  quantity: number
  quantityLabel: string
}

export type LowStockRow = {
  code: string
  description: string
  unitOfMeasure: string
  currentStock: string
  minStock: string
  belowMin: boolean
  hasMinStock: boolean
}

export type MovedArticleRow = {
  articleCode: string
  description: string
  unitOfMeasure: string
  caricoQty: number
  scaricoQty: number
  saldo: number
  caricoLabel: string
  scaricoLabel: string
  saldoLabel: string
}

export type WarehouseReport = {
  period: ReportPeriod
  articleCount: number
  /** Giacenze attuali aggregate per unità di misura (non mischiate). */
  stockByUnit: QuantityByUnit[]
  articlesWithNumericStock: number
  articlesWithoutNumericStock: number
  belowMinCount: number
  lowStockRows: LowStockRow[]
  articlesWithoutMinStock: number
  caricoCount: number
  scaricoCount: number
  caricoByUnit: QuantityByUnit[]
  scaricoByUnit: QuantityByUnit[]
  saldoByUnit: QuantityByUnit[]
  movedArticles: MovedArticleRow[]
  ddtInPeriod: DdtRegistryEntry[]
  ddtCount: number
}

/**
 * Normalizza UdM solo per aggregazione/visualizzazione Report
 * (case-insensitive, spazi ridotti). Non altera i dati in anagrafica.
 */
export function normalizeUnitForReport(unit: string): string {
  const compact = unit.trim().replace(/\s+/g, ' ')
  if (!compact || compact === '—') {
    return 'UdM non specificata'
  }
  return compact.toLocaleUpperCase('it-IT')
}

function toQuantityByUnit(map: Map<string, number>): QuantityByUnit[] {
  return [...map.entries()]
    .map(([unit, quantity]) => ({
      unit,
      quantity,
      quantityLabel: formatQuantity(quantity),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit))
}

function addToUnitMap(map: Map<string, number>, unit: string, delta: number): void {
  if (!Number.isFinite(delta)) {
    return
  }
  const key = normalizeUnitForReport(unit)
  map.set(key, (map.get(key) ?? 0) + delta)
}

/**
 * Report consultativo: solo lettura di articoli e movimenti già in IndexedDB.
 * Non scrive e non crea movimenti.
 */
export function buildWarehouseReport(
  articles: ArticleRecord[],
  movements: StockMovement[],
  period: ReportPeriod,
): WarehouseReport {
  const stockByUnitMap = new Map<string, number>()
  let articlesWithNumericStock = 0
  let articlesWithoutNumericStock = 0
  let articlesWithoutMinStock = 0
  const lowStockRows: LowStockRow[] = []

  const articleById = new Map<string, ArticleRecord>()
  for (const article of articles) {
    articleById.set(article.code.trim().toLowerCase(), article)

    const current = parseNumericStock(article.currentStock)
    if (current === null) {
      articlesWithoutNumericStock += 1
    } else {
      articlesWithNumericStock += 1
      addToUnitMap(stockByUnitMap, article.unitOfMeasure, current)
    }

    const min = parseNumericStock(article.minStock)
    const hasMinStock = min !== null
    if (!hasMinStock) {
      articlesWithoutMinStock += 1
    }
    const belowMin = hasMinStock && current !== null && current < min
    if (hasMinStock) {
      lowStockRows.push({
        code: article.code,
        description: article.description,
        unitOfMeasure: article.unitOfMeasure,
        currentStock: article.currentStock,
        minStock: article.minStock,
        belowMin,
        hasMinStock: true,
      })
    }
  }

  lowStockRows.sort((a, b) => {
    if (a.belowMin !== b.belowMin) {
      return a.belowMin ? -1 : 1
    }
    return a.code.localeCompare(b.code)
  })

  const periodMovements = movements.filter((movement) =>
    isDateInPeriod(movement.movementDate, period),
  )

  let caricoCount = 0
  let scaricoCount = 0
  const caricoByUnitMap = new Map<string, number>()
  const scaricoByUnitMap = new Map<string, number>()
  const moved = new Map<
    string,
    { caricoQty: number; scaricoQty: number; unit: string; description: string; code: string }
  >()

  for (const movement of periodMovements) {
    const article = articleById.get(movement.articleId)
    const unit = article?.unitOfMeasure ?? 'UdM non specificata'
    const description = article?.description ?? '—'
    const code = movement.articleCode

    let bucket = moved.get(movement.articleId)
    if (!bucket) {
      bucket = { caricoQty: 0, scaricoQty: 0, unit, description, code }
      moved.set(movement.articleId, bucket)
    }

    if (movement.type === 'CARICO') {
      caricoCount += 1
      addToUnitMap(caricoByUnitMap, unit, movement.quantity)
      bucket.caricoQty += movement.quantity
    } else if (movement.type === 'SCARICO') {
      scaricoCount += 1
      addToUnitMap(scaricoByUnitMap, unit, movement.quantity)
      bucket.scaricoQty += movement.quantity
    }
  }

  const units = new Set([...caricoByUnitMap.keys(), ...scaricoByUnitMap.keys()])
  const saldoByUnitMap = new Map<string, number>()
  for (const unit of units) {
    const inQty = caricoByUnitMap.get(unit) ?? 0
    const outQty = scaricoByUnitMap.get(unit) ?? 0
    saldoByUnitMap.set(unit, inQty - outQty)
  }

  const movedArticles: MovedArticleRow[] = [...moved.values()]
    .map((row) => {
      const saldo = row.caricoQty - row.scaricoQty
      return {
        articleCode: row.code,
        description: row.description,
        unitOfMeasure: row.unit,
        caricoQty: row.caricoQty,
        scaricoQty: row.scaricoQty,
        saldo,
        caricoLabel: formatQuantity(row.caricoQty),
        scaricoLabel: formatQuantity(row.scaricoQty),
        saldoLabel: formatQuantity(saldo),
      }
    })
    .sort((a, b) => a.articleCode.localeCompare(b.articleCode))

  const ddtRegistry = buildDdtRegistry(movements, articles)
  const ddtInPeriod = ddtRegistry.filter((entry) =>
    isDateInPeriod(entry.documentDateIso, period),
  )

  return {
    period,
    articleCount: articles.length,
    stockByUnit: toQuantityByUnit(stockByUnitMap),
    articlesWithNumericStock,
    articlesWithoutNumericStock,
    belowMinCount: lowStockRows.filter((row) => row.belowMin).length,
    lowStockRows,
    articlesWithoutMinStock,
    caricoCount,
    scaricoCount,
    caricoByUnit: toQuantityByUnit(caricoByUnitMap),
    scaricoByUnit: toQuantityByUnit(scaricoByUnitMap),
    saldoByUnit: toQuantityByUnit(saldoByUnitMap),
    movedArticles,
    ddtInPeriod,
    ddtCount: ddtInPeriod.length,
  }
}
