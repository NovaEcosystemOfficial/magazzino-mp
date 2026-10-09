import type { ArticleTargetField, ColumnMapping, RawSheetRow, SheetColumn } from '../types/articles'

const FIELD_ALIASES: Record<ArticleTargetField, string[]> = {
  code: [
    'codice',
    'codice articolo',
    'cod articolo',
    'cod. articolo',
    'cod',
    'cod.',
    'sku',
    'articolo codice',
    'code',
    'item code',
  ],
  description: [
    'descrizione',
    'descrizione articolo',
    'descrizione materiale',
    'descr.',
    'articolo',
    'nome',
    'nome articolo',
    'description',
    'materiale',
  ],
  unitOfMeasure: [
    'unita di misura',
    'unità di misura',
    'unita misura',
    'unità misura',
    'u.m.',
    'u.m',
    'um',
    'udm',
    'unit of measure',
    'uom',
  ],
  stock: [
    'giacenza',
    'giacenze',
    'giacenza foglio',
    'quantita',
    'quantità',
    'qta',
    'qty',
    'stock',
    'esistenza',
  ],
  status: ['stato', 'status', 'attivo', 'abilitato'],
  category: ['categoria', 'category', 'famiglia', 'classe', 'tipo'],
  supplier: [
    'fornitore',
    'fornitore abituale',
    'fornitore abituale ',
    'supplier',
    'vendor',
  ],
  minStock: [
    'scorta minima',
    'scorta min',
    'scorta min.',
    'minimo',
    'stock minimo',
    'min stock',
    'reorder level',
  ],
  totalReceived: [
    'totale entrate',
    'totale entrate ricevuto',
    'totale entrate (ricevuto)',
    'entrate ricevute',
    'ricevuto',
    'totale ricevuto',
  ],
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_./\\()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholeAlias(normalizedHeader: string, alias: string): boolean {
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:\\s|$)`)
  return pattern.test(normalizedHeader)
}

function scoreHeaderAgainstAliases(
  header: string,
  aliases: string[],
  field: ArticleTargetField,
): number {
  const normalized = normalizeHeader(header)
  if (!normalized) {
    return 0
  }

  // Titoli lunghi / descrittivi non sono intestazioni di colonna.
  if (normalized.length > 40 || normalized.split(' ').length > 6) {
    return 0
  }

  // Evita che colonne di entrate/scorte minime finiscano sulla giacenza.
  if (field === 'stock') {
    if (
      normalized.includes('entrata') ||
      normalized.includes('entrate') ||
      normalized.includes('ricevut') ||
      normalized.includes('scorta min') ||
      normalized.includes('minimo')
    ) {
      return 0
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias)
    if (!normalizedAlias) {
      continue
    }
    if (normalized === normalizedAlias) {
      return 100
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias)
    if (normalizedAlias.length < 2) {
      continue
    }

    if (containsWholeAlias(normalized, normalizedAlias)) {
      if (field === 'stock' || field === 'minStock' || field === 'totalReceived') {
        return normalizedAlias.length >= 3 && normalized.length <= 32 ? 85 : 0
      }
      return 75
    }
  }

  return 0
}

export function parseNumericStock(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '—') {
    return null
  }

  // Rimuove spazi; non converte celle vuote in zero.
  let normalized = trimmed.replace(/\s/g, '')

  // Formati italiani: 1.234,56 oppure 1234,56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(normalized) || /^-?\d+,\d+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(',', '.')
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function isNumericStockValue(value: string): boolean {
  return parseNumericStock(value) !== null
}

function columnLooksNumeric(header: string, rows: RawSheetRow[]): boolean {
  const values = rows
    .map((row) => row.values[header]?.trim() ?? '')
    .filter(Boolean)

  if (values.length === 0) {
    return false
  }

  const numericCount = values.filter(isNumericStockValue).length
  return numericCount / values.length >= 0.6
}

export function suggestColumnMapping(
  columns: SheetColumn[],
  rows: RawSheetRow[],
): {
  mapping: ColumnMapping
  isCertain: boolean
} {
  const mapping: ColumnMapping = {}
  const usedHeaders = new Set<string>()
  const fields = Object.keys(FIELD_ALIASES) as ArticleTargetField[]

  for (const field of fields) {
    let bestHeader: string | undefined
    let bestScore = 0

    for (const column of columns) {
      if (usedHeaders.has(column.header)) {
        continue
      }

      const score = scoreHeaderAgainstAliases(column.header, FIELD_ALIASES[field], field)
      if (score > bestScore) {
        bestScore = score
        bestHeader = column.header
      }
    }

    const threshold = field === 'stock' || field === 'minStock' || field === 'totalReceived' ? 85 : 75
    if (!bestHeader || bestScore < threshold) {
      continue
    }

    if (
      (field === 'stock' || field === 'minStock' || field === 'totalReceived') &&
      !columnLooksNumeric(bestHeader, rows)
    ) {
      continue
    }

    mapping[field] = bestHeader
    usedHeaders.add(bestHeader)
  }

  const codeCertain = Boolean(mapping.code)
  const descriptionCertain = Boolean(mapping.description)
  const isCertain = codeCertain && descriptionCertain

  return { mapping, isCertain }
}

export const TARGET_FIELD_LABELS: Record<ArticleTargetField, string> = {
  code: 'Codice',
  description: 'Descrizione',
  unitOfMeasure: 'Unità di misura',
  stock: 'Giacenza iniziale (foglio)',
  status: 'Stato',
  category: 'Categoria',
  supplier: 'Fornitore abituale',
  minStock: 'Scorta minima',
  totalReceived: 'Totale entrate (ricevuto)',
}

export const REQUIRED_TARGET_FIELDS: ArticleTargetField[] = ['code', 'description']
