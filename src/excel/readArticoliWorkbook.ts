import * as XLSX from 'xlsx'
import type { ArticoliSheetData, RawSheetRow, SheetColumn } from '../types/articles'
import { suggestColumnMapping } from './articoliMapping'
import {
  buildSurroundingRows,
  cellToDisplay,
  detectHeaderRow,
  type MatrixCell,
} from './detectHeaderRow'

const ARTICOLI_SHEET_NAME = 'articoli'

function findArticoliSheetName(sheetNames: string[]): string | undefined {
  return sheetNames.find((name) => name.trim().toLowerCase() === ARTICOLI_SHEET_NAME)
}

function buildUniqueHeader(rawHeader: string, index: number, used: Set<string>): string {
  const base = rawHeader.trim() || `Colonna ${index + 1}`
  let candidate = base
  let suffix = 2

  while (used.has(candidate)) {
    candidate = `${base} (${suffix})`
    suffix += 1
  }

  used.add(candidate)
  return candidate
}

function cellToString(value: MatrixCell): string {
  return cellToDisplay(value)
}

export async function readArticoliWorkbook(file: File): Promise<ArticoliSheetData> {
  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
    throw new Error('Il file selezionato non è un workbook Excel valido (.xlsx o .xls).')
  }

  let workbook: XLSX.WorkBook

  try {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch {
    throw new Error('Impossibile leggere il file Excel. Verifica che non sia danneggiato o protetto.')
  }

  if (!workbook.SheetNames.length) {
    throw new Error('Il workbook non contiene fogli leggibili.')
  }

  const sheetName = findArticoliSheetName(workbook.SheetNames)
  if (!sheetName) {
    const available = workbook.SheetNames.join(', ')
    throw new Error(
      `Foglio "Articoli" non trovato nel workbook. Fogli disponibili: ${available || 'nessuno'}.`,
    )
  }

  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error(`Il foglio "${sheetName}" non è leggibile.`)
  }

  // blankrows: true per mantenere i numeri di riga Excel coerenti con il foglio.
  const matrix = XLSX.utils.sheet_to_json<MatrixCell[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  })

  if (!matrix.length) {
    throw new Error('Il foglio "Articoli" è vuoto: nessuna intestazione o riga dati trovata.')
  }

  const detection = detectHeaderRow(matrix)
  const headerCells = matrix[detection.headerRowIndex] ?? []
  const usedHeaders = new Set<string>()
  const columns: SheetColumn[] = []

  const maxColumnCount = Math.max(
    headerCells.length,
    ...matrix.slice(detection.headerRowIndex, detection.headerRowIndex + 20).map((row) => row?.length ?? 0),
  )

  for (let index = 0; index < maxColumnCount; index += 1) {
    const header = buildUniqueHeader(cellToString(headerCells[index]), index, usedHeaders)
    columns.push({ header, index })
  }

  if (!columns.length || columns.every((column) => !column.header.trim())) {
    throw new Error('Impossibile individuare le intestazioni nel foglio "Articoli".')
  }

  const rows: RawSheetRow[] = []

  for (let rowIndex = detection.headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const cells = matrix[rowIndex] ?? []
    const values: Record<string, string> = {}
    let hasAnyValue = false

    columns.forEach((column) => {
      const value = cellToString(cells[column.index])
      values[column.header] = value
      if (value) {
        hasAnyValue = true
      }
    })

    if (!hasAnyValue) {
      continue
    }

    rows.push({
      excelRowNumber: rowIndex + 1,
      values,
    })
  }

  if (!rows.length) {
    throw new Error(
      `Il foglio "Articoli" non contiene righe dati dopo l'intestazione individuata (riga ${detection.headerRowNumber}).`,
    )
  }

  const { mapping, isCertain } = suggestColumnMapping(columns, rows)
  const mappingIsCertain = isCertain && detection.reliable

  return {
    fileName: file.name,
    sheetName,
    columns,
    rows,
    suggestedMapping: mapping,
    mappingIsCertain,
    headerRowNumber: detection.headerRowNumber,
    headerDetectionReliable: detection.reliable,
    headerDetectionReason: detection.reason,
    surroundingRows: buildSurroundingRows(matrix, detection.headerRowIndex),
  }
}
