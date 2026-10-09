import type { ArticleRecord, ArticleTargetField, ColumnMapping } from '../types/articles'
import { emptyDisplayValue, normalizeArticleRecord } from '../types/articles'
import { normalizeHeader, parseNumericStock } from './articoliMapping'

const SOURCE_ALIASES: Record<
  Exclude<ArticleTargetField, 'code' | 'description'>,
  string[]
> = {
  unitOfMeasure: [
    'unita di misura',
    'unità di misura',
    'u.m.',
    'u.m',
    'um',
    'udm',
  ],
  stock: ['giacenza', 'giacenze', 'giacenza foglio', 'esistenza', 'qta', 'quantita', 'quantità'],
  status: ['stato', 'stato foglio', 'status'],
  category: ['categoria', 'category', 'famiglia', 'classe', 'tipo'],
  supplier: ['fornitore', 'fornitore abituale', 'supplier', 'vendor'],
  minStock: ['scorta minima', 'scorta min', 'scorta min.', 'stock minimo', 'minimo'],
  totalReceived: [
    'totale entrate',
    'totale entrate ricevuto',
    'totale entrate (ricevuto)',
    'entrate ricevute',
    'totale ricevuto',
    'ricevuto',
  ],
}

function isBlankDisplay(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 || trimmed === '—'
}

function headerMatchesAlias(header: string, aliases: string[]): boolean {
  const normalized = normalizeHeader(header)
  if (!normalized) {
    return false
  }

  return aliases.some((alias) => {
    const normalizedAlias = normalizeHeader(alias)
    return (
      normalized === normalizedAlias ||
      (normalizedAlias.length >= 3 &&
        (normalized === normalizedAlias ||
          normalized.startsWith(`${normalizedAlias} `) ||
          normalized.endsWith(` ${normalizedAlias}`) ||
          normalized.includes(` ${normalizedAlias} `)))
    )
  })
}

/**
 * Recupera un valore dai campi originali del foglio senza inventare dati.
 * Non usa mai "Totale entrate" come giacenza.
 */
export function findSourceFieldValue(
  sourceFields: Record<string, string>,
  field: keyof typeof SOURCE_ALIASES,
): { header: string; value: string } | null {
  const aliases = SOURCE_ALIASES[field]

  for (const [header, rawValue] of Object.entries(sourceFields)) {
    const value = rawValue.trim()
    if (!value) {
      continue
    }

    if (field === 'stock') {
      const normalized = normalizeHeader(header)
      if (
        normalized.includes('entrata') ||
        normalized.includes('entrate') ||
        normalized.includes('ricevut') ||
        normalized.includes('scorta min')
      ) {
        continue
      }
    }

    if (headerMatchesAlias(header, aliases)) {
      return { header, value }
    }
  }

  return null
}

export function formatPreservedNumericDisplay(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return '—'
  }
  // Conserva la stringa originale del foglio; non forzare 0.
  return trimmed
}

export function enrichArticleFromSourceFields(article: ArticleRecord): ArticleRecord {
  const sourceFields = article.sourceFields ?? {}

  const pick = (
    current: string,
    field: keyof typeof SOURCE_ALIASES,
    options?: { numericOnly?: boolean },
  ): string => {
    if (!isBlankDisplay(current)) {
      return current.trim()
    }

    const found = findSourceFieldValue(sourceFields, field)
    if (!found) {
      return '—'
    }

    if (options?.numericOnly) {
      return parseNumericStock(found.value) !== null ? formatPreservedNumericDisplay(found.value) : '—'
    }

    return formatPreservedNumericDisplay(found.value)
  }

  return normalizeArticleRecord({
    ...article,
    unitOfMeasure: pick(article.unitOfMeasure, 'unitOfMeasure'),
    stock: pick(article.stock, 'stock', { numericOnly: false }),
    // Giacenza operativa: non ricalcolata dall'Excel; resta quella già presente.
    currentStock: article.currentStock,
    status: pick(article.status, 'status'),
    category: pick(article.category, 'category'),
    supplier: pick(article.supplier, 'supplier'),
    minStock: pick(article.minStock, 'minStock', { numericOnly: false }),
    // Totale entrate: solo se interpretabile numericamente.
    totalReceived: pick(article.totalReceived, 'totalReceived', { numericOnly: true }),
    sourceFields,
  })
}

export function buildSavedFieldsSummary(article: ArticleRecord): string[] {
  const enriched = enrichArticleFromSourceFields(article)
  const rows: Array<[string, string]> = [
    ['Codice', enriched.code],
    ['Descrizione', enriched.description],
    ['Unità di misura', enriched.unitOfMeasure],
    ['Giacenza iniziale', enriched.stock],
    ['Stato', enriched.status],
    ['Categoria', enriched.category],
    ['Fornitore abituale', enriched.supplier],
    ['Scorta minima', enriched.minStock],
    ['Totale entrate (ricevuto)', enriched.totalReceived],
  ]

  const summary = rows
    .filter(([, value]) => !isBlankDisplay(value))
    .map(([label, value]) => `${label}: ${value}`)

  const extraCount = Object.keys(enriched.sourceFields).length
  if (extraCount > 0) {
    summary.push(`Campi originali workbook conservati: ${extraCount}`)
  }

  return summary
}

function valueFromMappedHeader(
  sourceFields: Record<string, string>,
  mapping: ColumnMapping | undefined,
  field: ArticleTargetField,
  fallback: string,
): string {
  const direct = fallback.trim()
  if (direct) {
    return direct
  }

  const header = mapping?.[field]
  if (!header) {
    return ''
  }

  // Lookup esatto sull'intestazione scelta nel mapping (anche con suffissi univoci).
  const exact = sourceFields[header]?.trim() ?? ''
  if (exact) {
    return exact
  }

  // Fallback: confronto normalizzato tra chiavi di sourceFields e header mappato.
  const normalizedTarget = normalizeHeader(header)
  for (const [key, value] of Object.entries(sourceFields)) {
    if (normalizeHeader(key) === normalizedTarget && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

export function resolvePreviewRowToArticle(
  input: {
    code: string
    description: string
    unitOfMeasure: string
    stock: string
    status: string
    category: string
    supplier: string
    minStock: string
    totalReceived: string
    sourceFields: Record<string, string>
  },
  mapping?: ColumnMapping,
): ArticleRecord {
  const stock = valueFromMappedHeader(input.sourceFields, mapping, 'stock', input.stock)
  const category = valueFromMappedHeader(input.sourceFields, mapping, 'category', input.category)
  const supplier = valueFromMappedHeader(input.sourceFields, mapping, 'supplier', input.supplier)
  const minStock = valueFromMappedHeader(input.sourceFields, mapping, 'minStock', input.minStock)
  const totalReceivedRaw = valueFromMappedHeader(
    input.sourceFields,
    mapping,
    'totalReceived',
    input.totalReceived,
  )
  const unitOfMeasure = valueFromMappedHeader(
    input.sourceFields,
    mapping,
    'unitOfMeasure',
    input.unitOfMeasure,
  )
  const status = valueFromMappedHeader(input.sourceFields, mapping, 'status', input.status)

  const base = normalizeArticleRecord({
    code: input.code,
    description: emptyDisplayValue(input.description),
    unitOfMeasure: emptyDisplayValue(unitOfMeasure),
    // Conserva il valore grezzo della colonna giacenza; non convertire vuoto in 0.
    stock: stock || '—',
    status: emptyDisplayValue(status) === '—' ? 'Importato' : emptyDisplayValue(status),
    category: emptyDisplayValue(category),
    supplier: emptyDisplayValue(supplier),
    minStock: minStock || '—',
    totalReceived:
      totalReceivedRaw && parseNumericStock(totalReceivedRaw) !== null ? totalReceivedRaw : '—',
    sourceFields: input.sourceFields,
  })

  return enrichArticleFromSourceFields(base)
}
