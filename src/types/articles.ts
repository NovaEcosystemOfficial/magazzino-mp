export type ArticleRecord = {
  code: string
  description: string
  unitOfMeasure: string
  /** Giacenza iniziale storica dal workbook; non è un movimento di magazzino e non va alterata dai carichi. */
  stock: string
  /**
   * Giacenza operativa attuale.
   * Parti dalla giacenza Excel e viene aggiornata dai movimenti (es. CARICO).
   */
  currentStock: string
  status: string
  category: string
  supplier: string
  minStock: string
  /**
   * Totale entrate (ricevuto) storico del workbook, solo se presente e numerico.
   * Non va interpretato come nuovo carico.
   */
  totalReceived: string
  /** Tutti i campi originali del foglio (intestazione → valore), senza perdita dati. */
  sourceFields: Record<string, string>
}

export type ArticleTargetField =
  | 'code'
  | 'description'
  | 'unitOfMeasure'
  | 'stock'
  | 'status'
  | 'category'
  | 'supplier'
  | 'minStock'
  | 'totalReceived'

export type ColumnMapping = Partial<Record<ArticleTargetField, string>>

export type SheetColumn = {
  header: string
  index: number
}

export type RawSheetRow = {
  excelRowNumber: number
  values: Record<string, string>
}

export type SurroundingSheetRow = {
  excelRowNumber: number
  cells: string[]
  isHeaderRow: boolean
}

export type ArticoliSheetData = {
  fileName: string
  sheetName: string
  columns: SheetColumn[]
  rows: RawSheetRow[]
  suggestedMapping: ColumnMapping
  mappingIsCertain: boolean
  headerRowNumber: number
  headerDetectionReliable: boolean
  headerDetectionReason: string
  surroundingRows: SurroundingSheetRow[]
}

export type PreviewIssueKind =
  | 'missing_code'
  | 'duplicate_code'
  | 'missing_description'
  | 'empty_row'
  | 'invalid_stock'
  | 'existing_in_archive'

export type ArticoliPreviewRow = {
  excelRowNumber: number
  code: string
  description: string
  unitOfMeasure: string
  stock: string
  status: string
  category: string
  supplier: string
  minStock: string
  totalReceived: string
  extraFields: Record<string, string>
  sourceFields: Record<string, string>
  issues: PreviewIssueKind[]
  willImport: boolean
}

export type ArticoliPreviewResult = {
  rows: ArticoliPreviewRow[]
  importableCount: number
  ignoredCount: number
  errorCount: number
  duplicateCodes: string[]
}

export type ArticoliImportSummary = {
  imported: number
  ignored: number
  errors: number
  skippedExisting: number
  enrichedExisting: number
  fileName: string
  messages: string[]
  persisted: boolean
}

export function emptyDisplayValue(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : '—'
}

export function normalizeArticleRecord(raw: Partial<ArticleRecord> & { code: string }): ArticleRecord {
  const stock = emptyDisplayValue(raw.stock)
  const hasCurrent =
    typeof raw.currentStock === 'string' &&
    raw.currentStock.trim().length > 0 &&
    raw.currentStock.trim() !== '—'

  return {
    code: raw.code.trim(),
    description: emptyDisplayValue(raw.description),
    unitOfMeasure: emptyDisplayValue(raw.unitOfMeasure),
    stock,
    // Se assente (record pre-migrazione), parte dalla giacenza Excel storica.
    currentStock: hasCurrent ? raw.currentStock!.trim() : stock === '—' ? '0' : stock,
    status: emptyDisplayValue(raw.status),
    category: emptyDisplayValue(raw.category),
    supplier: emptyDisplayValue(raw.supplier),
    minStock: emptyDisplayValue(raw.minStock),
    totalReceived: emptyDisplayValue(raw.totalReceived),
    sourceFields:
      raw.sourceFields && typeof raw.sourceFields === 'object' ? { ...raw.sourceFields } : {},
  }
}
