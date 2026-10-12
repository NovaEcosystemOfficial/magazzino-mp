import { buildDdtDocumentFingerprint } from './ddtDocumentIdentity'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatQuantity } from '../utils/quantity'

/**
 * Un movimento proviene dall’importazione DDT se la chiave di idempotenza
 * o le note lo indicano esplicitamente. I carichi manuali restano fuori dal Registro.
 */
export function isDdtImportMovement(movement: StockMovement): boolean {
  if (movement.type !== 'CARICO') {
    return false
  }
  const key = movement.idempotencyKey.trim().toLowerCase()
  if (key.startsWith('ddt-row|') || key.startsWith('ddt|')) {
    return true
  }
  return /^importazione\s+ddt\b/i.test(movement.notes.trim())
}

export type DdtRegistryLine = {
  movementId: string
  articleCode: string
  articleDescription: string
  quantity: number
  quantityLabel: string
  registeredAt: string
  notes: string
}

export type DdtRegistryEntry = {
  /** Fingerprint stabile numero+fornitore+data (una sola riga per documento). */
  id: string
  documentNumber: string
  documentDateIso: string
  supplier: string
  lineCount: number
  totalQuantity: number | null
  totalQuantityLabel: string
  registeredAt: string
  lines: DdtRegistryLine[]
  movementIds: string[]
}

function compareIsoDesc(a: string, b: string): number {
  return b.localeCompare(a)
}

/**
 * Aggrega i carichi da importazione DDT in documenti unici.
 * Non crea archivi paralleli e non inventa campi assenti.
 */
export function buildDdtRegistry(
  movements: StockMovement[],
  articles: ArticleRecord[] = [],
): DdtRegistryEntry[] {
  const descriptionByCode = new Map<string, string>()
  for (const article of articles) {
    descriptionByCode.set(article.code.trim().toLowerCase(), article.description)
  }

  const groups = new Map<string, StockMovement[]>()

  for (const movement of movements) {
    if (!isDdtImportMovement(movement)) {
      continue
    }
    const documentNumber = movement.documentRef.trim()
    const supplier = movement.supplier.trim()
    const documentDateIso = movement.movementDate.trim()
    if (!documentNumber || !supplier || !documentDateIso) {
      // Dati incompleti: salta la riga senza bloccare il registro.
      continue
    }
    const id = buildDdtDocumentFingerprint({
      documentNumber,
      supplier,
      documentDateIso,
    })
    const bucket = groups.get(id)
    if (bucket) {
      bucket.push(movement)
    } else {
      groups.set(id, [movement])
    }
  }

  const entries: DdtRegistryEntry[] = []

  for (const [id, rows] of groups) {
    const sortedRows = [...rows].sort((a, b) => {
      const byReg = a.registeredAt.localeCompare(b.registeredAt)
      if (byReg !== 0) {
        return byReg
      }
      return a.articleCode.localeCompare(b.articleCode)
    })

    const first = sortedRows[0]
    let total = 0
    let allQuantitiesOk = true
    const lines: DdtRegistryLine[] = []

    for (const row of sortedRows) {
      if (!Number.isFinite(row.quantity)) {
        allQuantitiesOk = false
      } else {
        total += row.quantity
      }
      lines.push({
        movementId: row.id,
        articleCode: row.articleCode,
        articleDescription: descriptionByCode.get(row.articleId) ?? '—',
        quantity: row.quantity,
        quantityLabel: Number.isFinite(row.quantity) ? formatQuantity(row.quantity) : '—',
        registeredAt: row.registeredAt,
        notes: row.notes,
      })
    }

    const registeredAt = sortedRows.reduce(
      (earliest, row) => (row.registeredAt < earliest ? row.registeredAt : earliest),
      first.registeredAt,
    )

    entries.push({
      id,
      documentNumber: first.documentRef.trim(),
      documentDateIso: first.movementDate.trim(),
      supplier: first.supplier.trim(),
      lineCount: lines.length,
      totalQuantity: allQuantitiesOk ? total : null,
      totalQuantityLabel: allQuantitiesOk ? formatQuantity(total) : '—',
      registeredAt,
      lines,
      movementIds: lines.map((line) => line.movementId),
    })
  }

  return entries.sort((a, b) => {
    const byDocDate = compareIsoDesc(a.documentDateIso, b.documentDateIso)
    if (byDocDate !== 0) {
      return byDocDate
    }
    const byReg = compareIsoDesc(a.registeredAt, b.registeredAt)
    if (byReg !== 0) {
      return byReg
    }
    return a.documentNumber.localeCompare(b.documentNumber)
  })
}

export type DdtRegistryFilters = {
  query: string
  dateFrom: string
  dateTo: string
}

export function filterDdtRegistry(
  entries: DdtRegistryEntry[],
  filters: DdtRegistryFilters,
): DdtRegistryEntry[] {
  const q = filters.query.trim().toLowerCase()
  const from = filters.dateFrom.trim()
  const to = filters.dateTo.trim()

  return entries.filter((entry) => {
    if (from && entry.documentDateIso < from) {
      return false
    }
    if (to && entry.documentDateIso > to) {
      return false
    }
    if (!q) {
      return true
    }
    return (
      entry.documentNumber.toLowerCase().includes(q) ||
      entry.supplier.toLowerCase().includes(q)
    )
  })
}
