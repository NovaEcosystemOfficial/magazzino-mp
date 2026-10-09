import { normalizeHeader } from './articoliMapping'

export type MatrixCell = string | number | boolean | Date | null | undefined

export type HeaderDetectionResult = {
  headerRowIndex: number
  headerRowNumber: number
  reliable: boolean
  reason: string
}

function cellToDisplay(value: MatrixCell): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) {
    return value.toLocaleDateString('it-IT')
  }
  return String(value).trim()
}

function nonEmptyCells(row: MatrixCell[] | undefined): string[] {
  return (row ?? []).map(cellToDisplay).filter(Boolean)
}

function isLikelyTitleRow(row: MatrixCell[] | undefined): boolean {
  const values = nonEmptyCells(row)
  if (values.length === 0) {
    return false
  }
  // Titoli/celle unite: una sola cella valorizzata, spesso lunga.
  if (values.length === 1) {
    return true
  }
  // Poche celle ma testo molto lungo → intestazione descrittiva, non tabella.
  const longest = Math.max(...values.map((value) => value.length))
  return values.length <= 2 && longest >= 40
}

const HEADER_HINTS = [
  'codice',
  'descrizione',
  'unita',
  'unità',
  'u.m',
  'um',
  'giacenza',
  'quantita',
  'quantità',
  'stato',
  'articolo',
  'materiale',
  'sku',
]

function headerLabelScore(row: MatrixCell[] | undefined): number {
  const values = nonEmptyCells(row)
  if (values.length < 2) {
    return 0
  }

  let score = values.length * 8

  for (const value of values) {
    const normalized = normalizeHeader(value)
    if (!normalized) {
      continue
    }

    // Intestazioni tipiche: testo breve, non numerico.
    if (/^-?\d+([.,]\d+)?$/.test(normalized)) {
      score -= 12
      continue
    }

    if (normalized.length <= 28) {
      score += 6
    } else if (normalized.length >= 40) {
      score -= 20
    }

    if (HEADER_HINTS.some((hint) => normalized === hint || normalized.includes(hint))) {
      score += 18
    }
  }

  return score
}

function isNumericLike(value: string): boolean {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  if (!normalized) {
    return false
  }
  return /^-?\d+(\.\d+)?$/.test(normalized)
}

function dataCoherenceScore(matrix: MatrixCell[][], headerIndex: number): number {
  const header = matrix[headerIndex] ?? []
  const columnCount = Math.max(header.length, ...matrix.slice(headerIndex, headerIndex + 12).map((row) => row?.length ?? 0))
  if (columnCount < 2) {
    return 0
  }

  const sampleRows = matrix.slice(headerIndex + 1, headerIndex + 16)
  const usableRows = sampleRows.filter((row) => nonEmptyCells(row).length > 0)
  if (usableRows.length === 0) {
    return 0
  }

  let score = usableRows.length * 4

  for (let col = 0; col < columnCount; col += 1) {
    const values = usableRows
      .map((row) => cellToDisplay(row?.[col]))
      .filter(Boolean)

    if (values.length === 0) {
      continue
    }

    const numericCount = values.filter(isNumericLike).length
    const textCount = values.length - numericCount
    const avgLength = values.reduce((sum, value) => sum + value.length, 0) / values.length

    // Colonne dati tipiche: testo medio (descrizioni) o numeri (giacenze/codici).
    if (textCount >= values.length * 0.6 && avgLength >= 3) {
      score += 10
    }
    if (numericCount >= values.length * 0.6) {
      score += 10
    }
    if (values.length >= 3) {
      score += 4
    }
  }

  // Penalizza se le righe successive sembrano ancora titoli.
  const titleLikeFollowers = usableRows.filter((row) => isLikelyTitleRow(row)).length
  score -= titleLikeFollowers * 15

  return score
}

export function detectHeaderRow(matrix: MatrixCell[][]): HeaderDetectionResult {
  const scanLimit = Math.min(matrix.length, 40)
  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < scanLimit; index += 1) {
    const row = matrix[index]
    const values = nonEmptyCells(row)
    if (values.length < 2) {
      continue
    }
    if (isLikelyTitleRow(row)) {
      continue
    }

    const labelScore = headerLabelScore(row)
    const coherence = dataCoherenceScore(matrix, index)
    const score = labelScore + coherence

    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  if (bestIndex < 0) {
    // Fallback: prima riga con almeno 2 celle non vuote.
    for (let index = 0; index < scanLimit; index += 1) {
      if (nonEmptyCells(matrix[index]).length >= 2) {
        return {
          headerRowIndex: index,
          headerRowNumber: index + 1,
          reliable: false,
          reason:
            'Nessuna riga intestazione affidabile trovata: usata la prima riga con più celle valorizzate.',
        }
      }
    }

    return {
      headerRowIndex: 0,
      headerRowNumber: 1,
      reliable: false,
      reason: 'Impossibile individuare una riga intestazione tabellare affidabile.',
    }
  }

  const reliable = bestScore >= 40 && nonEmptyCells(matrix[bestIndex]).length >= 2

  return {
    headerRowIndex: bestIndex,
    headerRowNumber: bestIndex + 1,
    reliable,
    reason: reliable
      ? 'Riga intestazione individuata analizzando titolo iniziale e coerenza delle colonne dati.'
      : 'Riga intestazione proposta con affidabilità limitata: verificare manualmente.',
  }
}

export function buildSurroundingRows(
  matrix: MatrixCell[][],
  headerRowIndex: number,
  radius = 3,
): Array<{ excelRowNumber: number; cells: string[]; isHeaderRow: boolean }> {
  const start = Math.max(0, headerRowIndex - radius)
  const end = Math.min(matrix.length - 1, headerRowIndex + radius)
  const rows: Array<{ excelRowNumber: number; cells: string[]; isHeaderRow: boolean }> = []

  const maxColumns = Math.max(
    1,
    ...matrix.slice(start, end + 1).map((row) => row?.length ?? 0),
    matrix[headerRowIndex]?.length ?? 0,
  )

  for (let index = start; index <= end; index += 1) {
    const row = matrix[index] ?? []
    const cells: string[] = []
    for (let col = 0; col < maxColumns; col += 1) {
      cells.push(cellToDisplay(row[col]))
    }

    // Salta righe totalmente vuote fuori dalla zona utile, ma tieni header e dintorni con contenuto.
    if (cells.every((cell) => !cell) && index !== headerRowIndex) {
      continue
    }

    rows.push({
      excelRowNumber: index + 1,
      cells,
      isHeaderRow: index === headerRowIndex,
    })
  }

  return rows
}

export { cellToDisplay }
