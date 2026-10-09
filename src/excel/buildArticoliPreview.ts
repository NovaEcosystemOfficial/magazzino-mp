import type {
  ArticoliPreviewResult,
  ArticoliPreviewRow,
  ArticoliSheetData,
  ArticleRecord,
  ColumnMapping,
  PreviewIssueKind,
} from '../types/articles'
import { isNumericStockValue, REQUIRED_TARGET_FIELDS } from './articoliMapping'
import { resolvePreviewRowToArticle } from './resolveArticleFields'

function getMappedValue(
  rowValues: Record<string, string>,
  mapping: ColumnMapping,
  field: keyof ColumnMapping,
) {
  const header = mapping[field]
  if (!header) {
    return ''
  }
  return rowValues[header]?.trim() ?? ''
}

export function isMappingComplete(mapping: ColumnMapping): boolean {
  return REQUIRED_TARGET_FIELDS.every((field) => Boolean(mapping[field]?.trim()))
}

export function buildArticoliPreview(
  sheetData: ArticoliSheetData,
  mapping: ColumnMapping,
  existingCodes: ReadonlySet<string> = new Set(),
): ArticoliPreviewResult {
  const mappedHeaders = new Set(
    Object.values(mapping).filter((header): header is string => Boolean(header)),
  )

  const normalizedExisting = new Set(
    [...existingCodes].map((code) => code.trim().toLowerCase()).filter(Boolean),
  )

  const codeOccurrences = new Map<string, number>()
  for (const row of sheetData.rows) {
    const code = getMappedValue(row.values, mapping, 'code')
    if (!code) {
      continue
    }
    const key = code.toLowerCase()
    codeOccurrences.set(key, (codeOccurrences.get(key) ?? 0) + 1)
  }

  const seenCodes = new Set<string>()
  const duplicateCodes = new Set<string>()
  const rows: ArticoliPreviewRow[] = []

  for (const row of sheetData.rows) {
    const code = getMappedValue(row.values, mapping, 'code')
    const description = getMappedValue(row.values, mapping, 'description')
    const unitOfMeasure = getMappedValue(row.values, mapping, 'unitOfMeasure')
    const stock = getMappedValue(row.values, mapping, 'stock')
    const status = getMappedValue(row.values, mapping, 'status')
    const category = getMappedValue(row.values, mapping, 'category')
    const supplier = getMappedValue(row.values, mapping, 'supplier')
    const minStock = getMappedValue(row.values, mapping, 'minStock')
    const totalReceived = getMappedValue(row.values, mapping, 'totalReceived')

    const sourceFields: Record<string, string> = {}
    for (const column of sheetData.columns) {
      const value = row.values[column.header]?.trim() ?? ''
      if (value) {
        sourceFields[column.header] = value
      }
    }

    const extraFields: Record<string, string> = {}
    for (const [header, value] of Object.entries(sourceFields)) {
      if (!mappedHeaders.has(header)) {
        extraFields[header] = value
      }
    }

    const issues: PreviewIssueKind[] = []
    const hasAnyMappedValue = Boolean(
      code ||
        description ||
        unitOfMeasure ||
        stock ||
        status ||
        category ||
        supplier ||
        minStock ||
        totalReceived,
    )

    if (!hasAnyMappedValue && Object.keys(extraFields).length === 0) {
      issues.push('empty_row')
    }

    let willImport = false

    if (!code) {
      issues.push('missing_code')
    } else {
      const key = code.toLowerCase()
      if ((codeOccurrences.get(key) ?? 0) > 1) {
        issues.push('duplicate_code')
        duplicateCodes.add(code)
      }

      if (normalizedExisting.has(key)) {
        issues.push('existing_in_archive')
        willImport = false
        seenCodes.add(key)
      } else if (seenCodes.has(key)) {
        willImport = false
      } else {
        seenCodes.add(key)
        willImport = true
      }
    }

    if (!description) {
      issues.push('missing_description')
    }

    if (mapping.stock && stock && !isNumericStockValue(stock)) {
      issues.push('invalid_stock')
    }

    rows.push({
      excelRowNumber: row.excelRowNumber,
      code,
      description,
      unitOfMeasure,
      stock,
      status,
      category,
      supplier,
      minStock,
      totalReceived,
      extraFields,
      sourceFields,
      issues,
      willImport,
    })
  }

  const importableCount = rows.filter((row) => row.willImport).length
  const ignoredCount = rows.filter((row) => !row.willImport).length
  const errorCount = rows.filter(
    (row) =>
      row.issues.includes('missing_code') ||
      row.issues.includes('duplicate_code') ||
      row.issues.includes('invalid_stock'),
  ).length

  return {
    rows,
    importableCount,
    ignoredCount,
    errorCount,
    duplicateCodes: [...duplicateCodes],
  }
}

/**
 * Include sia le righe nuove (willImport) sia quelle già in archivio:
 * queste ultime devono arrivare a persistNewArticles per l'arricchimento
 * dei campi mancanti. Esclude solo duplicati interni al file e righe senza codice.
 */
export function previewRowsToArticles(
  preview: ArticoliPreviewResult,
  mapping?: ColumnMapping,
): ArticleRecord[] {
  return preview.rows
    .filter(
      (row) =>
        row.willImport ||
        (row.issues.includes('existing_in_archive') && Boolean(row.code.trim())),
    )
    .map((row) =>
      resolvePreviewRowToArticle(
        {
          code: row.code,
          description: row.description,
          unitOfMeasure: row.unitOfMeasure,
          stock: row.stock,
          status: row.status,
          category: row.category,
          supplier: row.supplier,
          minStock: row.minStock,
          totalReceived: row.totalReceived,
          sourceFields: row.sourceFields,
        },
        mapping,
      ),
    )
}

export function issueLabel(issue: PreviewIssueKind): string {
  switch (issue) {
    case 'missing_code':
      return 'Codice mancante'
    case 'duplicate_code':
      return 'Codice duplicato'
    case 'missing_description':
      return 'Descrizione mancante'
    case 'empty_row':
      return 'Riga vuota'
    case 'invalid_stock':
      return 'Giacenza non numerica'
    case 'existing_in_archive':
      return 'Già presente in archivio'
    default:
      return issue
  }
}
